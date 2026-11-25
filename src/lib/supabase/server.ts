/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  getActiveFirebaseSession,
  isFirebaseServerConfigured,
} from "@/lib/firebase/server";
import {
  createMockSupabaseServerClient,
  getActiveDevUser,
  isDevAccessAllowed,
  type DevRole,
  type DevUser,
} from "../dev-access";

export function isRealSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("YOUR_PROJECT_REF"),
  );
}

export function isSupabaseServerConfigured(): boolean {
  if (isRealSupabaseConfigured() || isFirebaseServerConfigured()) {
    return true;
  }
  return isDevAccessAllowed();
}

export async function createSupabaseServerClient(): Promise<any> {
  const isReal = isRealSupabaseConfigured();

  if (!isReal && isFirebaseServerConfigured()) {
    const fbSession = await getActiveFirebaseSession();
    const mappedUser: (DevUser & { trade?: string }) | null = fbSession
      ? {
          id: fbSession.uid,
          email: fbSession.email,
          phone: fbSession.phone ?? "",
          role: (fbSession.role ?? null) as DevRole,
          display_name: fbSession.displayName,
          account_status: (fbSession.accountStatus === "paused" ? "active" : fbSession.accountStatus) as "active",
          verification_status:
            fbSession.verificationStatus === "approved" ? "approved" : "unverified",
          rating_avg: 0,
          rating_count: 0,
          trade: fbSession.trade ?? undefined,
          rawAccountStatus: fbSession.accountStatus,
          rawVerificationStatus: fbSession.verificationStatus,
        } as DevUser & {
          trade?: string;
          rawAccountStatus?: string;
          rawVerificationStatus?: string;
        }
      : null;

    return createMockSupabaseServerClient(mappedUser);
  }

  if (isDevAccessAllowed() && !isReal) {
    const devUser = await getActiveDevUser();
    return createMockSupabaseServerClient(devUser);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    if (isDevAccessAllowed()) {
      const devUser = await getActiveDevUser();
      return createMockSupabaseServerClient(devUser);
    }
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component where setting cookies is read-only;
          // middleware refreshes auth cookies on each request.
        }
      },
    },
  });
}
