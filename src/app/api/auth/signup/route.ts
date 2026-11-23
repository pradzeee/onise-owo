import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LEGAL_VERSIONS } from "@/lib/constants";
import { isDevAccessAllowed } from "@/lib/dev-access";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
} from "@/lib/supabase/server";

const signupSchema = z
  .object({
    email: z.string().trim().email("Please enter a valid email address.").toLowerCase(),
    password: z.string().min(6, "Password must be at least 6 characters."),
    displayName: z.string().trim().min(2, "Name must be at least 2 characters."),
    role: z.enum(["customer", "artisan"], {
      errorMap: () => ({ message: "Choose either Customer or Artisan." }),
    }),
    trade: z.string().optional(),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: "You must accept the terms to create an account." }),
    }),
  })
  .refine(
    (data) => {
      if (data.role === "artisan" && (!data.trade || data.trade.trim() === "")) {
        return false;
      }
      return true;
    },
    { message: "Please select your trade category.", path: ["trade"] },
  );

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null);
    const parsed = signupSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid registration details." },
        { status: 400 },
      );
    }

    const { email, password, displayName, role, trade } = parsed.data;

    // 1. Live Supabase Registration Flow
    if (isRealSupabaseConfigured()) {
      const supabase = await createSupabaseServerClient();
      const origin = request.nextUrl.origin;

      // Duplicate email check: check if profile with this email already exists
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("email", email)
        .maybeSingle();

      if (existingProfile) {
        return NextResponse.json(
          {
            error: `An account with this email already exists as a ${existingProfile.role}. Please log in instead.`,
          },
          { status: 409 },
        );
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${origin}/auth/callback`,
          data: {
            role,
            trade: role === "artisan" ? trade : undefined,
            display_name: displayName,
          },
        },
      });

      if (error) {
        logger.warn("auth.signup_failed", { message: error.message });
        const isDuplicate = error.message.toLowerCase().includes("already registered") ||
          error.message.toLowerCase().includes("user already exists");
        return NextResponse.json(
          {
            error: isDuplicate
              ? "An account with this email already exists. Please log in instead."
              : error.message || "Could not complete registration.",
          },
          { status: isDuplicate ? 409 : 400 },
        );
      }

      // Supabase anti-enumeration check: empty identities indicates duplicate user
      if (data.user?.identities && data.user.identities.length === 0) {
        return NextResponse.json(
          { error: "An account with this email already exists. Please log in instead." },
          { status: 409 },
        );
      }

      if (data.user) {
        await supabase.rpc("complete_onboarding", {
          p_role: role,
          p_terms_version: LEGAL_VERSIONS.terms_of_service,
          p_privacy_version: LEGAL_VERSIONS.privacy_policy,
          p_accepted_required: true,
          p_idempotency_key: `signup-${data.user.id}`,
        });

        if (role === "artisan" && trade) {
          await supabase
            .from("artisan_profiles")
            .upsert({
              user_id: data.user.id,
              trade,
              verification_status: "unverified",
              is_online: false,
            });
        }
      }

      logger.info("auth.signup_success", { userId: data.user?.id, role, trade });
      return NextResponse.json({
        ok: true,
        nextPath: role === "artisan" ? "/artisan/onboarding" : "/dashboard",
      });
    }

    // 2. Preview / Demo Mode (Strict Duplicate Email Protection)
    if (isDevAccessAllowed()) {
      const cookieStore = await cookies();
      const rawUsers = cookieStore.get("onise_registered_users")?.value;
      const registeredUsers: Record<string, {
        email: string;
        displayName: string;
        role: "customer" | "artisan";
        trade?: string;
        createdAt: string;
      }> = rawUsers ? JSON.parse(rawUsers) : {};

      if (registeredUsers[email]) {
        const existing = registeredUsers[email];
        return NextResponse.json(
          {
            error: `An account with this email already exists as a ${existing.role}. Please log in instead.`,
          },
          { status: 409 },
        );
      }

      registeredUsers[email] = {
        email,
        displayName,
        role,
        trade: role === "artisan" ? trade : undefined,
        createdAt: new Date().toISOString(),
      };

      cookieStore.set("onise_registered_users", JSON.stringify(registeredUsers), {
        path: "/",
        sameSite: "lax",
        httpOnly: true,
      });

      cookieStore.set("onise_user_email", email, { path: "/", sameSite: "lax" });
      cookieStore.set("onise_user_name", displayName, { path: "/", sameSite: "lax" });
      cookieStore.set("onise_user_role", role, { path: "/", sameSite: "lax" });
      if (role === "artisan" && trade) {
        cookieStore.set("onise_user_trade", trade, { path: "/", sameSite: "lax" });
      }

      return NextResponse.json({
        ok: true,
        nextPath: role === "artisan" ? "/artisan/onboarding" : "/dashboard",
      });
    }

    return NextResponse.json(
      { error: "Registration service is currently unavailable." },
      { status: 503 },
    );
  } catch (err) {
    logger.error("auth.signup_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not create account. Please try again." },
      { status: 500 },
    );
  }
}
