import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_MFA_COOKIE_NAME, hashAdminMfaToken } from "@/lib/admin-auth";
import {
  FIREBASE_SESSION_COOKIE_NAME,
  FIREBASE_TOKEN_COOKIE_NAME,
} from "@/lib/firebase/session-cookie";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
} from "@/lib/supabase/server";

export async function POST() {
  const cookieStore = await cookies();
  const mfaCookie = cookieStore.get(ADMIN_MFA_COOKIE_NAME)?.value;

  if (mfaCookie && isRealSupabaseConfigured() && isSupabaseAdminConfigured()) {
    const admin = createSupabaseAdminClient();
    await admin
      .from("admin_mfa_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("session_token_hash", hashAdminMfaToken(mfaCookie));
  }

  if (isRealSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }

  const res = NextResponse.json({ ok: true });
  const cookiesToClear = [
    FIREBASE_SESSION_COOKIE_NAME,
    FIREBASE_TOKEN_COOKIE_NAME,
    ADMIN_MFA_COOKIE_NAME,
    "onise_dev_role",
    "onise_user_email",
    "onise_user_role",
    "onise_user_name",
    "onise_user_phone",
    "onise_user_trade",
    "onise_registered_users",
    "onise_session",
  ];

  for (const cookieName of cookiesToClear) {
    res.cookies.delete(cookieName);
  }

  return res;
}
