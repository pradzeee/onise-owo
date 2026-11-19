/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";
import {
  createMockSupabaseServerClient,
  DEV_USERS,
  isDevAccessAllowed,
} from "../dev-access";

export function isRealSupabaseAdminConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("YOUR_PROJECT_REF") &&
      !process.env.SUPABASE_SERVICE_ROLE_KEY.includes("your-supabase"),
  );
}

export function isSupabaseAdminConfigured(): boolean {
  if (isDevAccessAllowed()) {
    return true;
  }
  return isRealSupabaseAdminConfigured();
}

export function createSupabaseAdminClient(): any {
  if (isDevAccessAllowed() && !isRealSupabaseAdminConfigured()) {
    return createMockSupabaseServerClient(DEV_USERS.admin);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    if (isDevAccessAllowed()) {
      return createMockSupabaseServerClient(DEV_USERS.admin);
    }
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
