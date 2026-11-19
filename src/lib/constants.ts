export const APP_NAME = "Oníṣẹ́ ọwọ́";
export const APP_TAGLINE = "Trusted verified artisans near you in Nigeria";
export const APP_TIMEZONE = "Africa/Lagos";

export const LEGAL_VERSIONS = {
  age_18_plus: "2026-11-v1",
  terms_of_service: "2026-11-v1",
  privacy_policy: "2026-11-v1",
  location: "2026-11-v1",
  notifications: "2026-11-v1",
  face_matching: "2026-11-v1",
} as const;

export type UserRole = "customer" | "artisan" | "admin";
export type SelectableRole = "customer" | "artisan";

export const SELECTABLE_ROLES: readonly SelectableRole[] = ["customer", "artisan"] as const;

export type AccountStatus = "active" | "paused" | "suspended" | "deleted";
export type VerificationStatus =
  | "unverified"
  | "pending"
  | "approved"
  | "rejected"
  | "suspended";

export type ConsentType =
  | "age_18_plus"
  | "terms_of_service"
  | "privacy_policy"
  | "location"
  | "notifications"
  | "face_matching";

export type OptionalConsentType = "location" | "notifications" | "face_matching";

export const OPTIONAL_CONSENT_TYPES: readonly OptionalConsentType[] = [
  "location",
  "notifications",
  "face_matching",
] as const;

export const TRADES = [
  { id: "plumber", label: "Plumber", description: "Leaks, pipes, boreholes & fittings" },
  { id: "electrician", label: "Electrician", description: "Wiring, inverters, solar & faults" },
  { id: "tailor", label: "Tailor", description: "Bespoke wears, alterations & native styles" },
  { id: "carpenter", label: "Carpenter", description: "Furniture, doors, roofs & repairs" },
  { id: "mechanic", label: "Mechanic", description: "Car diagnostics, servicing & repairs" },
  { id: "painter", label: "Painter", description: "Interior, exterior & screed finishing" },
  { id: "makeup_artist", label: "Makeup Artist", description: "Bridal, events & studio glam" },
] as const;

export interface ProfileRecord {
  id: string;
  role: UserRole | null;
  display_name: string | null;
  account_status: AccountStatus;
  verification_status: VerificationStatus;
  rating_avg: number;
  rating_count: number;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConsentRecord {
  id: string;
  user_id: string;
  consent_type: ConsentType;
  version: string;
  granted: boolean;
  consented_at: string;
  withdrawn_at: string | null;
  created_at: string;
}

export type ArtisanTrade = (typeof TRADES)[number]["id"];

export interface ArtisanProfileRecord {
  user_id: string;
  full_name: string;
  photo_path: string | null;
  trade: ArtisanTrade;
  bio: string;
  work_area: string;
  payout_recipient_code: string | null;
  payout_subaccount_code: string | null;
  verification_status: VerificationStatus;
  rejection_reason: string | null;
  is_online: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtisanVerificationRecord {
  id: string;
  user_id: string;
  provider_name: string;
  provider_reference: string;
  provider_status: "pending" | "passed" | "failed";
  liveness_passed: boolean;
  face_match_passed: boolean;
  checked_at: string;
  created_at: string;
  updated_at: string;
}

export interface GuarantorVerificationRecord {
  id: string;
  artisan_id: string;
  guarantor_name: string;
  status: "pending" | "confirmed" | "expired" | "revoked";
  confirmed_at: string | null;
  sms_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRecord {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface NearbyArtisanResult {
  artisan_id: string;
  full_name: string;
  photo_path: string | null;
  photo_url: string | null;
  trade: ArtisanTrade;
  work_area: string;
  rating_avg: number;
  rating_count: number;
  distance_meters: number;
  approx_lat: number;
  approx_lng: number;
  last_seen_at: string;
}

export interface AlertDeliveryRecord {
  id: string;
  user_id: string;
  alert_type: "job_request" | "quote_update" | "job_status" | "test_alert";
  reference_id: string | null;
  status: "pending" | "push_sent" | "push_delivered" | "sms_sent" | "failed";
  push_attempted_at: string | null;
  push_delivered_at: string | null;
  sms_fallback_due_at: string;
  sms_fallback_sent_at: string | null;
  created_at: string;
}

export type JobStatus =
  | "requested"
  | "accepted"
  | "quoted"
  | "quote_accepted"
  | "paid"
  | "en_route"
  | "arrived"
  | "in_progress"
  | "completed"
  | "confirmed"
  | "cancelled"
  | "expired"
  | "disputed"
  | "refunded";

export type JobRequestStatus = "sent" | "accepted" | "declined" | "expired" | "taken";
export type QuoteStatus = "pending" | "accepted" | "declined" | "superseded";
export type DispatchMode = "direct" | "nearest_3";

export interface JobRecord {
  id: string;
  customer_id: string;
  artisan_id: string | null;
  trade: ArtisanTrade;
  description: string;
  photo_paths: string[];
  dispatch_mode: DispatchMode;
  dispatch_round: number;
  round_expires_at: string | null;
  approx_area_label: string;
  status: JobStatus;
  accepted_quote_id: string | null;
  accepted_amount_kobo: number | null;
  cancel_fee_kobo: number;
  cancelled_by: string | null;
  cancel_reason: string | null;
  accepted_at: string | null;
  en_route_at: string | null;
  arrived_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  expired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobRequestRecord {
  id: string;
  job_id: string;
  artisan_id: string;
  round_number: number;
  status: JobRequestStatus;
  sent_at: string;
  expires_at: string;
  responded_at: string | null;
}

export interface QuoteRecord {
  id: string;
  job_id: string;
  artisan_id: string;
  amount_kobo: number;
  notes: string | null;
  status: QuoteStatus;
  created_at: string;
  responded_at: string | null;
}

export interface TrustedContactRecord {
  user_id: string;
  contact_name: string;
  contact_phone_e164: string;
  updated_at: string;
}

export interface JobMessageRecord {
  id: string;
  job_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

export interface JobChatStatus {
  can_read: boolean;
  can_send: boolean;
  is_blocked: boolean;
  closes_at: string | null;
  closed_reason: string | null;
}

export const DISPUTE_REASONS = [
  { id: "incomplete_work", label: "Work was not completed" },
  { id: "poor_quality", label: "Work quality does not match agreed quote" },
  { id: "property_damage", label: "Accidental damage to property" },
  { id: "overcharge_dispute", label: "Price or extra-charges dispute" },
  { id: "no_show", label: "Artisan did not show up / abandoned job" },
  { id: "other", label: "Other issue" },
] as const;

export type DisputeReason = (typeof DISPUTE_REASONS)[number]["id"];

export interface PaymentRecord {
  id: string;
  job_id: string;
  provider_reference: string;
  amount_kobo: number;
  commission_kobo: number;
  status: "pending" | "paid" | "failed" | "amount_mismatch";
  refund_status: "none" | "pending" | "refunded" | "failed";
  release_paused: boolean;
  paid_at: string | null;
  created_at: string;
}

export interface DisputeRecord {
  id: string;
  job_id: string;
  opened_by: string;
  reason: DisputeReason;
  details: string;
  status: "open" | "resolved_release" | "resolved_refund" | "dismissed";
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface ReconciliationReportRecord {
  id: string;
  report_date: string;
  our_paid_count: number;
  our_paid_total_kobo: number;
  our_commission_total_kobo: number;
  paystack_paid_count: number;
  paystack_paid_total_kobo: number;
  missing_in_our_db_refs: string[];
  missing_in_paystack_refs: string[];
  amount_mismatch_refs: string[];
  status: "matched" | "discrepancy" | "skipped_mock";
  created_at: string;
  updated_at: string;
}

export interface ReviewRecord {
  id: string;
  job_id: string;
  reviewer_id: string | null;
  reviewee_id: string;
  reviewer_role: "customer" | "artisan";
  reviewer_display_name: string;
  rating: number;
  comment: string | null;
  is_anonymized: boolean;
  created_at: string;
}

export interface ArtisanPublicProfile {
  artisan_id: string;
  full_name: string;
  photo_path: string | null;
  trade: ArtisanTrade;
  bio: string;
  work_area: string;
  rating_avg: number;
  rating_count: number;
  is_online: boolean;
  verified_since: string | null;
}
