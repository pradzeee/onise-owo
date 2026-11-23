import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DEV_ROLE_COOKIE_NAME, isDevAccessAllowed } from "@/lib/dev-access";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
} from "@/lib/supabase/server";

const emailLoginSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter a valid Gmail or email address.")
    .toLowerCase(),
});

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null);
    const parsed = emailLoginSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid email address." },
        { status: 400 },
      );
    }

    const { email } = parsed.data;
    const origin = request.nextUrl.origin;

    // 1. Live Supabase Auth Flow
    if (isRealSupabaseConfigured()) {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${origin}/auth/callback`,
        },
      });

      if (error) {
        logger.warn("auth.email_otp_failed", { message: error.message });
        return NextResponse.json(
          { error: error.message || "Could not send sign-in link. Please try again." },
          { status: 400 },
        );
      }

      logger.info("auth.email_otp_sent", { email });
      return NextResponse.json({
        ok: true,
        sent: true,
        message: `We sent a sign-in link to ${email}. Check your inbox to continue!`,
      });
    }

    // 2. Demo / Preview Testing Mode
    // Allows testers to sign in instantly with their Gmail without live Supabase email config
    if (isDevAccessAllowed()) {
      const cookieStore = await cookies();

      // Check if user has an existing role; default new testers to customer
      const existingRole = cookieStore.get(DEV_ROLE_COOKIE_NAME)?.value;
      const targetRole = existingRole || "customer";

      cookieStore.set(DEV_ROLE_COOKIE_NAME, targetRole, {
        path: "/",
        sameSite: "lax",
      });

      // Save the tester's email in a session cookie so it appears in profile
      cookieStore.set("onise_user_email", email, {
        path: "/",
        sameSite: "lax",
      });

      return NextResponse.json({
        ok: true,
        instantLogin: true,
        nextPath: existingRole ? "/dashboard" : "/onboarding",
      });
    }

    return NextResponse.json(
      { error: "Authentication service is temporarily unavailable." },
      { status: 503 },
    );
  } catch (err) {
    logger.error("auth.email_login_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
