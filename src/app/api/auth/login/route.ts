import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isDevAccessAllowed } from "@/lib/dev-access";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
} from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address.").toLowerCase(),
  password: z.string().min(6, "Password must be at least 6 characters."),
});

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null);
    const parsed = loginSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid login credentials." },
        { status: 400 },
      );
    }

    const { email, password } = parsed.data;

    // 1. Live Supabase Password Sign-In
    if (isRealSupabaseConfigured()) {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        logger.warn("auth.password_login_failed", { message: error.message });
        return NextResponse.json(
          { error: error.message || "Invalid email or password." },
          { status: 401 },
        );
      }

      logger.info("auth.password_login_success", { userId: data.user?.id });
      return NextResponse.json({
        ok: true,
        nextPath: "/dashboard",
      });
    }

    // 2. Preview / Demo Mode (Tester sign-in without live Supabase env vars)
    if (isDevAccessAllowed()) {
      const cookieStore = await cookies();

      cookieStore.set("onise_user_email", email, {
        path: "/",
        sameSite: "lax",
      });

      cookieStore.set("onise_user_name", email.split("@")[0], {
        path: "/",
        sameSite: "lax",
      });

      const existingRole = cookieStore.get("onise_user_role")?.value;

      return NextResponse.json({
        ok: true,
        nextPath: existingRole ? "/dashboard" : "/onboarding",
      });
    }

    return NextResponse.json(
      { error: "Authentication service is currently unavailable." },
      { status: 503 },
    );
  } catch (err) {
    logger.error("auth.login_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not log in. Please try again." },
      { status: 500 },
    );
  }
}
