import crypto from "crypto";
import { cookies } from "next/headers";
import { hmacHash } from "./crypto";
import { getActiveDevUser, isDevAccessAllowed } from "./dev-access";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "./supabase/admin";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "./supabase/server";

export const ADMIN_MFA_COOKIE_NAME = "onise_admin_mfa";
export const ADMIN_MFA_SESSION_HOURS = 4;

export function hashAdminMfaToken(rawToken: string): string {
  return hmacHash("admin:mfa_session", rawToken.trim());
}

export function generateAdminMfaToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashAdminMfaToken(rawToken) };
}

export interface AdminAuthCheckResult {
  authenticated: boolean;
  isAdmin: boolean;
  mfaVerified: boolean;
  userId: string | null;
}

/**
 * Checks whether the current request is:
 * 1) Signed in via Supabase Auth,
 * 2) An active `role = 'admin'` user in `public.profiles`, AND
 * 3) Verified via Admin Two-Step Login (`onise_admin_mfa` HTTP-only cookie matching
 *    an unexpired, non-revoked row in `public.admin_mfa_sessions`).
 */
export async function checkAdminTwoStep(): Promise<AdminAuthCheckResult> {
  // In local development, allow switching directly into the Admin dashboard
  if (isDevAccessAllowed()) {
    const devUser = await getActiveDevUser();
    if (devUser?.role === "admin") {
      return {
        authenticated: true,
        isAdmin: true,
        mfaVerified: true,
        userId: devUser.id,
      };
    }
  }

  if (!isSupabaseServerConfigured() || !isSupabaseAdminConfigured()) {
    return { authenticated: false, isAdmin: false, mfaVerified: false, userId: null };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { authenticated: false, isAdmin: false, mfaVerified: false, userId: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, account_status")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "admin" || profile.account_status !== "active") {
    return { authenticated: true, isAdmin: false, mfaVerified: false, userId: user.id };
  }

  const cookieStore = await cookies();
  const rawToken = cookieStore.get(ADMIN_MFA_COOKIE_NAME)?.value;
  if (!rawToken || rawToken.length < 24) {
    return { authenticated: true, isAdmin: true, mfaVerified: false, userId: user.id };
  }

  const tokenHash = hashAdminMfaToken(rawToken);
  const admin = createSupabaseAdminClient();
  const { data: mfaSession } = await admin
    .from("admin_mfa_sessions")
    .select("id, expires_at, revoked_at")
    .eq("admin_id", user.id)
    .eq("session_token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  return {
    authenticated: true,
    isAdmin: true,
    mfaVerified: Boolean(mfaSession),
    userId: user.id,
  };
}
