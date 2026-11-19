/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  createMockSupabaseServerClient,
  getActiveDevUser,
  isDevAccessAllowed,
  DEV_USERS,
} from "../dev-access";

export function isRealSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("YOUR_PROJECT_REF"),
  );
}

export function isSupabaseServerConfigured(): boolean {
  // In development, dev access mode provides full mock backend functionality
  if (isDevAccessAllowed()) {
    return true;
  }
  return isRealSupabaseConfigured();
}

export async function createSupabaseServerClient(): Promise<any> {
  const isReal = isRealSupabaseConfigured();

  // If in development mode and real Supabase is not configured, return the dev mock client.
  if (isDevAccessAllowed() && !isReal) {
    const devUser = await getActiveDevUser();
    return createMockSupabaseServerClient(devUser ?? DEV_USERS.admin);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    if (isDevAccessAllowed()) {
      const devUser = await getActiveDevUser();
      return createMockSupabaseServerClient(devUser ?? DEV_USERS.admin);
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
