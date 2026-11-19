import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkAdminTwoStep } from "@/lib/admin-auth";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const reviewSchema = z.object({
  decision: z.enum(["approved", "rejected", "suspended"]),
  reason: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ artisanId: string }> },
) {
  try {
    if (!isSupabaseServerConfigured()) {
      return NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 503 },
      );
    }

    const { artisanId } = await context.params;
    if (!UUID_REGEX.test(artisanId)) {
      return NextResponse.json({ error: "Invalid artisan ID." }, { status: 400 });
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = reviewSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid review payload." },
        { status: 400 },
      );
    }

    if (
      (parsed.data.decision === "rejected" || parsed.data.decision === "suspended") &&
      (!parsed.data.reason || parsed.data.reason.length < 5)
    ) {
      return NextResponse.json(
        {
          error:
            "Please provide a clear reason (at least 5 characters) when rejecting or suspending an artisan.",
        },
        { status: 400 },
      );
    }

    const check = await checkAdminTwoStep();
    if (!check.authenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!check.isAdmin || !check.mfaVerified) {
      return NextResponse.json(
        { error: "Admin two-step verification required.", mfaRequired: check.isAdmin },
        { status: 403 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Calls Postgres SECURITY DEFINER RPC using the authenticated admin's JWT.
    // Postgres enforces is_admin(auth.uid()), provider_status='passed', and guarantor='confirmed'.
    const { data, error } = await supabase.rpc("admin_review_artisan", {
      p_artisan_id: artisanId,
      p_decision: parsed.data.decision,
      p_reason: parsed.data.reason ?? null,
      p_idempotency_key:
        parsed.data.idempotencyKey ??
        request.headers.get("x-idempotency-key")?.trim() ??
        null,
    });

    if (error) {
      logger.warn("admin.review_artisan_failed", {
        adminId: user.id,
        artisanId,
        code: error.code,
      });
      return NextResponse.json(
        { error: error.message || "Could not apply admin decision." },
        { status: error.code === "42501" ? 403 : 400 },
      );
    }

    logger.info("admin.review_artisan_applied", {
      adminId: user.id,
      artisanId,
      decision: parsed.data.decision,
    });

    return NextResponse.json({ ok: true, artisan: data });
  } catch (err) {
    logger.error("admin.review_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Something went wrong saving your review decision." },
      { status: 500 },
    );
  }
}
