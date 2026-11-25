import { NextResponse } from "next/server";

/**
 * Retired legacy email-OTP endpoint. All authentication is standardized through
 * Firebase Google OAuth / Email+Password (`/api/auth/session`) or Supabase Auth.
 */
export async function POST() {
  return NextResponse.json(
    { error: "This login method has been retired. Use Google Sign-In or Email & Password." },
    { status: 410 },
  );
}
