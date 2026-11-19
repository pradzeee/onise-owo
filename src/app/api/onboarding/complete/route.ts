import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LEGAL_VERSIONS } from "@/lib/constants";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

// Strictly allows ONLY 'customer' or 'artisan'. 'admin' is rejected here AND in Postgres.
const onboardingSchema = z.object({
  role: z.enum(["customer", "artisan"], {
    errorMap: () => ({ message: "Choose either Customer or Artisan." }),
  }),
  acceptedAgeAndLegal: z.literal(true, {
    errorMap: () => ({
      message:
        "You must confirm that you are 18 or older and accept the Terms of Service and Privacy Policy.",
    }),
  }),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseServerConfigured()) {
      return NextResponse.json(
        { error: "Supabase is not configured yet." },
        { status: 503 },
      );
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = onboardingSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid onboarding input." },
        { status: 400 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Please sign in first." },
        { status: 401 },
      );
    }

    const headerKey = request.headers.get("x-idempotency-key")?.trim();
    const idempotencyKey = parsed.data.idempotencyKey ?? headerKey ?? null;

    // Server-side Postgres SECURITY DEFINER RPC enforces auth.uid(), blocks 'admin',
    // prevents role tampering, and inserts mandatory consents idempotently.
    const { data, error } = await supabase.rpc("complete_onboarding", {
      p_role: parsed.data.role,
      p_terms_version: LEGAL_VERSIONS.terms_of_service,
      p_privacy_version: LEGAL_VERSIONS.privacy_policy,
      p_accepted_required: parsed.data.acceptedAgeAndLegal,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      logger.warn("onboarding.complete_failed", {
        userId: user.id,
        code: error.code,
      });
      return NextResponse.json(
        { error: error.message || "Could not complete onboarding." },
        { status: error.code === "42501" ? 403 : 400 },
      );
    }

    logger.info("onboarding.completed", {
      userId: user.id,
      role: parsed.data.role,
    });

    return NextResponse.json({
      ok: true,
      profile: data,
      nextPath: "/dashboard",
    });
  } catch (err) {
    logger.error("onboarding.exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
