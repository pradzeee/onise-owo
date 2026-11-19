import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_MFA_COOKIE_NAME, generateAdminMfaToken } from "@/lib/admin-auth";
import { DEV_ROLE_COOKIE_NAME, isDevAccessAllowed, type DevRole } from "@/lib/dev-access";

export async function POST(request: NextRequest) {
  if (!isDevAccessAllowed()) {
    return NextResponse.json({ error: "Dev access is disabled in production." }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      role?: DevRole | "logout";
      redirectUrl?: string;
    };

    const cookieStore = await cookies();
    const role = body.role;

    if (role === "logout") {
      cookieStore.delete(DEV_ROLE_COOKIE_NAME);
      cookieStore.delete(ADMIN_MFA_COOKIE_NAME);
      return NextResponse.json({ ok: true, activeRole: null, redirectUrl: "/login" });
    }

    if (role !== "admin" && role !== "artisan" && role !== "customer") {
      return NextResponse.json({ error: "Invalid dev role." }, { status: 400 });
    }

    // Set dev role cookie (session-scoped)
    cookieStore.set(DEV_ROLE_COOKIE_NAME, role, {
      path: "/",
      httpOnly: false, // allow client banner to read current role
      sameSite: "lax",
    });

    // If role is admin, also seed admin MFA cookie so admin two-step passes immediately
    if (role === "admin") {
      const { rawToken } = generateAdminMfaToken();
      cookieStore.set(ADMIN_MFA_COOKIE_NAME, rawToken, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 4 * 60 * 60,
      });
    } else {
      cookieStore.delete(ADMIN_MFA_COOKIE_NAME);
    }

    const nextPath =
      body.redirectUrl ??
      (role === "admin" ? "/admin" : role === "artisan" ? "/dashboard" : "/find");

    return NextResponse.json({
      ok: true,
      activeRole: role,
      redirectUrl: nextPath,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to switch dev role" },
      { status: 500 },
    );
  }
}
