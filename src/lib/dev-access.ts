/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, prefer-const */
import { cookies } from "next/headers";
import type {
  ArtisanProfileRecord,
  AuditLogRecord,
  DisputeRecord,
  JobRecord,
  JobRequestRecord,
  NearbyArtisanResult,
  ProfileRecord,
} from "./constants";

export const DEV_ROLE_COOKIE_NAME = "onise_dev_role";

export type DevRole = "admin" | "artisan" | "customer";

export interface DevUser {
  id: string;
  email: string;
  phone: string;
  role: DevRole;
  display_name: string;
  account_status: "active";
  verification_status: "approved" | "unverified";
  rating_avg: number;
  rating_count: number;
}

export const DEV_USERS: Record<DevRole, DevUser> = {
  admin: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "admin@oniseowo.ng",
    phone: "+2348030000001",
    role: "admin",
    display_name: "Adewale Admin (Superuser)",
    account_status: "active",
    verification_status: "approved",
    rating_avg: 5.0,
    rating_count: 12,
  },
  artisan: {
    id: "00000000-0000-0000-0000-000000000002",
    email: "kazeem@oniseowo.ng",
    phone: "+2348030000002",
    role: "artisan",
    display_name: "Kazeem Alabi (Electrician)",
    account_status: "active",
    verification_status: "approved",
    rating_avg: 4.88,
    rating_count: 27,
  },
  customer: {
    id: "00000000-0000-0000-0000-000000000003",
    email: "chioma@oniseowo.ng",
    phone: "+2348030000003",
    role: "customer",
    display_name: "Chioma Okonkwo (Customer)",
    account_status: "active",
    verification_status: "approved",
    rating_avg: 5.0,
    rating_count: 4,
  },
};

/**
 * Returns true if Dev/Demo Access mode is permitted.
 * Permitted in development or when live Supabase credentials are not configured
 * (allowing Vercel preview deploys to function without setup).
 */
export function isDevAccessAllowed(): boolean {
  if (process.env.NEXT_PUBLIC_DISABLE_DEMO === "true") {
    return false;
  }
  const hasRealSupabase = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("YOUR_PROJECT_REF"),
  );
  if (hasRealSupabase) {
    return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEMO === "true";
  }
  return true;
}

/**
 * Reads the active user role from cookie.
 */
export async function getDevRole(): Promise<DevRole | null> {
  if (!isDevAccessAllowed()) return null;
  try {
    const cookieStore = await cookies();
    const role = cookieStore.get("onise_user_role")?.value as DevRole | undefined;
    if (role === "admin" || role === "artisan" || role === "customer") {
      return role;
    }
  } catch {
    // cookies() unavailable
  }
  return null;
}

/**
 * Returns the currently active authenticated user, or null if guest.
 * Prevents any automatic login into mock or pre-baked accounts.
 */
export async function getActiveDevUser(): Promise<DevUser | null> {
  try {
    const cookieStore = await cookies();
    const userEmail = cookieStore.get("onise_user_email")?.value;
    if (!userEmail) return null;

    const userRole = (cookieStore.get("onise_user_role")?.value as DevRole) || null;
    const userName = cookieStore.get("onise_user_name")?.value || userEmail.split("@")[0];
    const userPhone = cookieStore.get("onise_user_phone")?.value || "";

    return {
      id: `u-${Buffer.from(userEmail).toString("hex").slice(0, 12)}`,
      email: userEmail,
      phone: userPhone,
      role: userRole || ("customer" as DevRole),
      display_name: userName,
      account_status: "active",
      verification_status: "approved",
      rating_avg: 5.0,
      rating_count: 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mock In-Memory Database for Dev Mode
// ---------------------------------------------------------------------------

export const MOCK_PROFILES: ProfileRecord[] = [
  {
    id: DEV_USERS.admin.id,
    role: "admin",
    display_name: DEV_USERS.admin.display_name,
    account_status: "active",
    verification_status: "approved",
    rating_avg: 5.0,
    rating_count: 12,
    onboarding_completed_at: "2026-11-01T10:00:00Z",
    created_at: "2026-11-01T08:00:00Z",
    updated_at: "2026-11-18T10:00:00Z",
  },
  {
    id: DEV_USERS.artisan.id,
    role: "artisan",
    display_name: DEV_USERS.artisan.display_name,
    account_status: "active",
    verification_status: "approved",
    rating_avg: 4.88,
    rating_count: 27,
    onboarding_completed_at: "2026-11-05T12:00:00Z",
    created_at: "2026-11-05T09:00:00Z",
    updated_at: "2026-11-19T08:00:00Z",
  },
  {
    id: DEV_USERS.customer.id,
    role: "customer",
    display_name: DEV_USERS.customer.display_name,
    account_status: "active",
    verification_status: "approved",
    rating_avg: 5.0,
    rating_count: 4,
    onboarding_completed_at: "2026-11-10T14:00:00Z",
    created_at: "2026-11-10T13:30:00Z",
    updated_at: "2026-11-19T09:00:00Z",
  },
  {
    id: "00000000-0000-0000-0000-000000000004",
    role: "artisan",
    display_name: "Sunday Ogundipe (Plumber - Pending Review)",
    account_status: "active",
    verification_status: "pending",
    rating_avg: 0,
    rating_count: 0,
    onboarding_completed_at: "2026-11-19T06:00:00Z",
    created_at: "2026-11-19T05:30:00Z",
    updated_at: "2026-11-19T06:00:00Z",
  },
];

export const MOCK_ARTISAN_PROFILES: ArtisanProfileRecord[] = [
  {
    user_id: DEV_USERS.artisan.id,
    full_name: "Kazeem Alabi",
    photo_path: null,
    trade: "electrician",
    bio: "Certified residential & commercial electrician with 8+ years experience. Specializes in distribution boxes, solar/inverters, and fault troubleshooting.",
    work_area: "Surulere, Lagos",
    payout_recipient_code: "RCP_mock_kazeem",
    payout_subaccount_code: "SUB_mock_kazeem",
    verification_status: "approved",
    rejection_reason: null,
    is_online: true,
    reviewed_by: DEV_USERS.admin.id,
    reviewed_at: "2026-11-06T10:00:00Z",
    created_at: "2026-11-05T09:00:00Z",
    updated_at: "2026-11-19T08:00:00Z",
  },
  {
    user_id: "00000000-0000-0000-0000-000000000004",
    full_name: "Sunday Ogundipe",
    photo_path: null,
    trade: "plumber",
    bio: "Borehole installation, PPR piping, water heaters, and toilet plumbing.",
    work_area: "Yaba, Lagos",
    payout_recipient_code: "RCP_mock_sunday",
    payout_subaccount_code: "SUB_mock_sunday",
    verification_status: "pending",
    rejection_reason: null,
    is_online: false,
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-11-19T05:30:00Z",
    updated_at: "2026-11-19T06:00:00Z",
  },
  {
    user_id: "00000000-0000-0000-0000-000000000005",
    full_name: "Tunde Bakare",
    photo_path: null,
    trade: "carpenter",
    bio: "Custom modern kitchen cabinets, wardrobes, bedframes, and door hanging.",
    work_area: "Ikeja, Lagos",
    payout_recipient_code: "RCP_mock_tunde",
    payout_subaccount_code: "SUB_mock_tunde",
    verification_status: "approved",
    rejection_reason: null,
    is_online: true,
    reviewed_by: DEV_USERS.admin.id,
    reviewed_at: "2026-11-07T11:00:00Z",
    created_at: "2026-11-06T11:00:00Z",
    updated_at: "2026-11-19T08:30:00Z",
  },
  {
    user_id: "00000000-0000-0000-0000-000000000006",
    full_name: "Bisi Adeleke",
    photo_path: null,
    trade: "makeup_artist",
    bio: "Bridal, photoshoot, and traditional wedding makeup artist.",
    work_area: "Lekki Phase 1, Lagos",
    payout_recipient_code: "RCP_mock_bisi",
    payout_subaccount_code: "SUB_mock_bisi",
    verification_status: "approved",
    rejection_reason: null,
    is_online: true,
    reviewed_by: DEV_USERS.admin.id,
    reviewed_at: "2026-11-08T14:00:00Z",
    created_at: "2026-11-07T12:00:00Z",
    updated_at: "2026-11-19T09:15:00Z",
  },
];

export const MOCK_JOBS: JobRecord[] = [
  {
    id: "job-mock-001",
    customer_id: DEV_USERS.customer.id,
    artisan_id: DEV_USERS.artisan.id,
    trade: "electrician",
    description: "Distribution box tripping constantly. Need inspection and replacement of faulty 60A circuit breaker.",
    photo_paths: [],
    dispatch_mode: "direct",
    dispatch_round: 1,
    round_expires_at: null,
    approx_area_label: "Surulere, Lagos",
    status: "in_progress",
    accepted_quote_id: "quote-mock-001",
    accepted_amount_kobo: 3500000, // ₦35,000
    cancel_fee_kobo: 300000,
    cancelled_by: null,
    cancel_reason: null,
    accepted_at: "2026-11-19T08:30:00Z",
    en_route_at: "2026-11-19T08:45:00Z",
    arrived_at: "2026-11-19T09:05:00Z",
    started_at: "2026-11-19T09:15:00Z",
    completed_at: null,
    confirmed_at: null,
    cancelled_at: null,
    expired_at: null,
    created_at: "2026-11-19T08:15:00Z",
    updated_at: "2026-11-19T09:15:00Z",
  },
  {
    id: "job-mock-002",
    customer_id: DEV_USERS.customer.id,
    artisan_id: "00000000-0000-0000-0000-000000000005",
    trade: "carpenter",
    description: "Install 3 interior solid core wooden doors with mortise locks and hinges.",
    photo_paths: [],
    dispatch_mode: "nearest_3",
    dispatch_round: 1,
    round_expires_at: null,
    approx_area_label: "Ikeja, Lagos",
    status: "confirmed",
    accepted_quote_id: "quote-mock-002",
    accepted_amount_kobo: 4800000, // ₦48,000
    cancel_fee_kobo: 300000,
    cancelled_by: null,
    cancel_reason: null,
    accepted_at: "2026-11-15T10:00:00Z",
    en_route_at: "2026-11-15T10:30:00Z",
    arrived_at: "2026-11-15T11:00:00Z",
    started_at: "2026-11-15T11:15:00Z",
    completed_at: "2026-11-15T16:00:00Z",
    confirmed_at: "2026-11-15T17:00:00Z",
    cancelled_at: null,
    expired_at: null,
    created_at: "2026-11-15T09:00:00Z",
    updated_at: "2026-11-15T17:00:00Z",
  },
  {
    id: "job-mock-003",
    customer_id: DEV_USERS.customer.id,
    artisan_id: "00000000-0000-0000-0000-000000000004",
    trade: "plumber",
    description: "Water leaking under kitchen sink into cabinet. Pipe connector loose.",
    photo_paths: [],
    dispatch_mode: "direct",
    dispatch_round: 1,
    round_expires_at: null,
    approx_area_label: "Yaba, Lagos",
    status: "disputed",
    accepted_quote_id: "quote-mock-003",
    accepted_amount_kobo: 2200000, // ₦22,000
    cancel_fee_kobo: 300000,
    cancelled_by: null,
    cancel_reason: null,
    accepted_at: "2026-11-17T11:00:00Z",
    en_route_at: "2026-11-17T11:30:00Z",
    arrived_at: "2026-11-17T12:00:00Z",
    started_at: "2026-11-17T12:15:00Z",
    completed_at: "2026-11-17T13:30:00Z",
    confirmed_at: null,
    cancelled_at: null,
    expired_at: null,
    created_at: "2026-11-17T10:30:00Z",
    updated_at: "2026-11-17T14:00:00Z",
  },
];

export const MOCK_JOB_REQUESTS: JobRequestRecord[] = [
  {
    id: "req-mock-001",
    job_id: "job-mock-001",
    artisan_id: DEV_USERS.artisan.id,
    round_number: 1,
    status: "accepted",
    sent_at: "2026-11-19T08:16:00Z",
    expires_at: "2026-11-19T08:17:00Z",
    responded_at: "2026-11-19T08:16:30Z",
  },
];

export const MOCK_DISPUTES: DisputeRecord[] = [
  {
    id: "disp-mock-001",
    job_id: "job-mock-003",
    opened_by: DEV_USERS.customer.id,
    reason: "incomplete_work",
    details: "Pipe was repaired but started dripping again within 2 hours. Artisan has not answered calls.",
    status: "open",
    resolution_notes: null,
    resolved_at: null,
    created_at: "2026-11-17T14:00:00Z",
  },
];

export const MOCK_USER_REPORTS = [
  {
    id: "rep-mock-001",
    reporter_id: DEV_USERS.customer.id,
    reported_user_id: "00000000-0000-0000-0000-000000000004",
    job_id: "job-mock-003",
    category: "unprofessional_conduct",
    details: "Artisan left before confirming water pressure was stable.",
    status: "under_review",
    created_at: "2026-11-17T14:05:00Z",
  },
];

export const MOCK_SUSPENSIONS = [
  {
    id: "susp-mock-001",
    user_id: "00000000-0000-0000-0000-000000000004",
    trigger_type: "urgent_safety",
    reason: "Urgent safety complaint filed; temporary hold pending human review",
    status: "active",
    human_review_due_at: new Date(Date.now() + 86400000 * 2).toISOString(),
    created_at: "2026-11-17T14:10:00Z",
  },
];

export const MOCK_AUDIT_LOGS: AuditLogRecord[] = [
  {
    id: "audit-mock-001",
    actor_id: DEV_USERS.admin.id,
    action: "artisan.approved",
    target_type: "artisan_profiles",
    target_id: DEV_USERS.artisan.id,
    metadata: { reason: "NIN face match and guarantor verified" },
    created_at: "2026-11-06T10:00:00Z",
  },
  {
    id: "audit-mock-002",
    actor_id: DEV_USERS.admin.id,
    action: "admin.two_step_login",
    target_type: "admin_mfa_sessions",
    target_id: "session-mock-001",
    metadata: { method: "totp_rfc6238" },
    created_at: "2026-11-19T07:30:00Z",
  },
];

export const MOCK_CONSENTS = [
  {
    id: "c-1",
    user_id: DEV_USERS.customer.id,
    consent_type: "age_18_plus" as const,
    version: "2026-11-v1",
    granted: true,
    consented_at: "2026-11-10T14:00:00Z",
    withdrawn_at: null,
    created_at: "2026-11-10T14:00:00Z",
  },
  {
    id: "c-2",
    user_id: DEV_USERS.customer.id,
    consent_type: "location" as const,
    version: "2026-11-v1",
    granted: true,
    consented_at: "2026-11-10T14:00:00Z",
    withdrawn_at: null,
    created_at: "2026-11-10T14:00:00Z",
  },
  {
    id: "c-3",
    user_id: DEV_USERS.artisan.id,
    consent_type: "location" as const,
    version: "2026-11-v1",
    granted: true,
    consented_at: "2026-11-05T09:00:00Z",
    withdrawn_at: null,
    created_at: "2026-11-05T09:00:00Z",
  },
];

/**
 * Returns mock nearby artisans for `/api/artisans/nearby` based on requested trade and coordinates.
 */
export function getMockNearbyArtisans(
  trade: string,
  centerLat: number,
  centerLng: number,
): NearbyArtisanResult[] {
  // Pre-seed coordinates around Lagos (Surulere, Yaba, Ikeja, Lekki)
  const coordsMap: Record<string, { lat: number; lng: number }> = {
    [DEV_USERS.artisan.id]: { lat: 6.500, lng: 3.355 }, // Surulere
    "00000000-0000-0000-0000-000000000004": { lat: 6.516, lng: 3.385 }, // Yaba
    "00000000-0000-0000-0000-000000000005": { lat: 6.596, lng: 3.344 }, // Ikeja
    "00000000-0000-0000-0000-000000000006": { lat: 6.438, lng: 3.472 }, // Lekki
  };

  const results: NearbyArtisanResult[] = [];

  for (const art of MOCK_ARTISAN_PROFILES) {
    if (art.verification_status !== "approved" || !art.is_online) continue;
    if (trade && art.trade !== trade) continue;

    const coords = coordsMap[art.user_id] ?? {
      lat: centerLat + 0.015,
      lng: centerLng + 0.012,
    };

    // Simple approximate distance in meters
    const dLat = (coords.lat - centerLat) * 111_000;
    const dLng = (coords.lng - centerLng) * 111_000 * Math.cos((centerLat * Math.PI) / 180);
    const dist = Math.round(Math.sqrt(dLat * dLat + dLng * dLng));

    results.push({
      artisan_id: art.user_id,
      full_name: art.full_name,
      photo_path: art.photo_path,
      photo_url: null,
      trade: art.trade,
      work_area: art.work_area,
      rating_avg: art.user_id === DEV_USERS.artisan.id ? 4.88 : 4.95,
      rating_count: art.user_id === DEV_USERS.artisan.id ? 27 : 19,
      distance_meters: Math.max(800, dist),
      approx_lat: coords.lat,
      approx_lng: coords.lng,
      last_seen_at: new Date().toISOString(),
    });
  }

  // If no artisans match the exact trade, generate 1 dynamic nearby artisan for that trade
  if (results.length === 0) {
    results.push({
      artisan_id: "00000000-0000-0000-0000-000000000099",
      full_name: `Verified ${trade.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())}`,
      photo_path: null,
      photo_url: null,
      trade: trade as any,
      work_area: "Victoria Island, Lagos",
      rating_avg: 4.9,
      rating_count: 14,
      distance_meters: 1850,
      approx_lat: centerLat + 0.01,
      approx_lng: centerLng + 0.01,
      last_seen_at: new Date().toISOString(),
    });
  }

  return results.sort((a, b) => a.distance_meters - b.distance_meters);
}

/**
 * Fluent query builder mock for Supabase server calls in local dev mode.
 */
export function createMockSupabaseServerClient(devUser: DevUser | null) {
  const currentUser = devUser
    ? {
        id: devUser.id,
        email: devUser.email,
        phone: devUser.phone,
        role: "authenticated",
        app_metadata: {},
        user_metadata: { role: devUser.role },
        created_at: "2026-11-01T00:00:00Z",
      }
    : null;

  return {
    auth: {
      async getUser() {
        return { data: { user: currentUser }, error: null };
      },
      async signInWithOtp() {
        return { data: {}, error: null };
      },
      async verifyOtp() {
        return { data: { user: currentUser }, error: null };
      },
      async signOut() {
        return { error: null };
      },
    },
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "find_nearby_artisans") {
        const trade = String(args.p_trade ?? "");
        const lat = Number(args.p_lat ?? 6.5244);
        const lng = Number(args.p_lng ?? 3.3792);
        const artisans = getMockNearbyArtisans(trade, lat, lng);
        return Promise.resolve({ data: artisans, error: null });
      }
      if (fn === "admin_review_artisan") {
        return Promise.resolve({ data: { success: true }, error: null });
      }
      if (fn === "expire_stale_online_artisans") {
        return Promise.resolve({ data: 0, error: null });
      }
      if (fn === "complete_onboarding") {
        const role = String(args.p_role ?? "customer");
        if (currentUser) {
          (currentUser.user_metadata as any).role = role;
        }
        return Promise.resolve({
          data: {
            id: currentUser?.id,
            role,
            display_name: currentUser?.email?.split("@")[0] || "User",
            account_status: "active",
            verification_status: "approved",
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(tableName: string) {
      let data: any[] = [];

      switch (tableName) {
        case "profiles": {
          data = [...MOCK_PROFILES];
          if (currentUser && !data.some((p) => p.id === currentUser.id)) {
            data.push({
              id: currentUser.id,
              role: (currentUser.user_metadata as any)?.role || devUser?.role || null,
              display_name: currentUser.email?.split("@")[0] || "User",
              phone: currentUser.phone || null,
              account_status: "active",
              verification_status: "approved",
              rating_avg: 5.0,
              rating_count: 0,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
          break;
        }
        case "artisan_profiles":
          data = [...MOCK_ARTISAN_PROFILES];
          break;
        case "jobs":
          data = [...MOCK_JOBS];
          break;
        case "job_requests":
          data = [...MOCK_JOB_REQUESTS];
          break;
        case "disputes":
          data = [...MOCK_DISPUTES];
          break;
        case "user_reports":
          data = [...MOCK_USER_REPORTS];
          break;
        case "safety_suspensions":
          data = [...MOCK_SUSPENSIONS];
          break;
        case "audit_log":
          data = [...MOCK_AUDIT_LOGS];
          break;
        case "consents":
          data = [...MOCK_CONSENTS];
          break;
        case "admin_mfa_sessions":
          data = [
            {
              id: "session-mock-001",
              admin_id: DEV_USERS.admin.id,
              session_token_hash: "mock_mfa_hash",
              expires_at: new Date(Date.now() + 86400000).toISOString(),
              revoked_at: null,
            },
          ];
          break;
        default:
          data = [];
      }

      // Chainable filter state
      const filters: Array<(row: any) => boolean> = [];
      let limitCount: number | null = null;

      const chain = {
        select(_cols = "*") {
          return chain;
        },
        eq(col: string, val: any) {
          filters.push((row) => row[col] === val);
          return chain;
        },
        neq(col: string, val: any) {
          filters.push((row) => row[col] !== val);
          return chain;
        },
        is(col: string, val: any) {
          filters.push((row) => (row[col] ?? null) === val);
          return chain;
        },
        gt(col: string, val: any) {
          filters.push((row) => row[col] > val);
          return chain;
        },
        gte(col: string, val: any) {
          filters.push((row) => row[col] >= val);
          return chain;
        },
        lt(col: string, val: any) {
          filters.push((row) => row[col] < val);
          return chain;
        },
        lte(col: string, val: any) {
          filters.push((row) => row[col] <= val);
          return chain;
        },
        order(_col: string, _opts?: { ascending?: boolean }) {
          return chain;
        },
        limit(count: number) {
          limitCount = count;
          return chain;
        },
        async maybeSingle() {
          let filtered = data.filter((row) => filters.every((f) => f(row)));
          return { data: filtered[0] ?? null, error: null };
        },
        async single() {
          let filtered = data.filter((row) => filters.every((f) => f(row)));
          if (filtered.length === 0) {
            return { data: null, error: { message: "Row not found", code: "PGRST116" } };
          }
          return { data: filtered[0], error: null };
        },
        // Then-able for await supabase.from(...)
        then(resolve: (res: { data: any[]; error: null }) => void) {
          let filtered = data.filter((row) => filters.every((f) => f(row)));
          if (limitCount !== null) {
            filtered = filtered.slice(0, limitCount);
          }
          resolve({ data: filtered, error: null });
        },
      };

      return chain;
    },
  };
}
