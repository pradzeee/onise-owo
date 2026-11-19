import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_MFA_COOKIE_NAME, hashAdminMfaToken } from "@/lib/admin-auth";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export async function POST() {
  const cookieStore = await cookies();
  const mfaCookie = cookieStore.get(ADMIN_MFA_COOKIE_NAME)?.value;

  if (mfaCookie && isSupabaseAdminConfigured()) {
    const admin = createSupabaseAdminClient();
    await admin
      .from("admin_mfa_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("session_token_hash", hashAdminMfaToken(mfaCookie));
  }

  if (isSupabaseServerConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ADMIN_MFA_COOKIE_NAME);
  return res;
}
