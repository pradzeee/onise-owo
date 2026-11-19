# Oníṣẹ́ ọwọ́

Mobile-first installable PWA connecting customers across Nigeria with nearby verified artisans (plumbers, electricians, tailors, carpenters, mechanics, painters, and makeup artists).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fpradzeee%2Fonise-owo)

> 🌐 **Live Web Preview**: Deploy directly from your GitHub repository to [Vercel](https://vercel.com/new) in 1 click for a free live URL (e.g. `https://onise-owo.vercel.app`).

## Stack
- **Frontend & Server:** Next.js (App Router) + Tailwind CSS + PWA (`manifest.webmanifest`, `sw.js`)
- **Database, Auth, Storage, Realtime:** Supabase (Postgres + PostGIS, Phone OTP + Send SMS Hook for Termii / Africa's Talking, private & public Storage buckets, Realtime chat)
- **Maps:** Leaflet + OpenStreetMap
- **Payments:** Paystack (Subaccounts, 15% commission in whole kobo, HMAC-SHA512 verified webhooks, daily reconciliation)
- **Identity Verification:** Licensed Nigerian NIN face-match + liveness adapter (Dojah / Prembly) + Guarantor SMS OTP confirmation

## All 9 Steps Implemented
1. **Setup & Login** (`0001_step1_setup_and_login.sql`): Nigerian phone + OTP login with CAPTCHA & HMAC rate limits, Send SMS Hook (`supabase/functions/send-sms-hook`), Customer/Artisan role onboarding (never Admin), 18+/Terms/Privacy + separate withdrawable consents (`location`, `notifications`, `face_matching`), `Africa/Lagos` time display, whole-kobo money helpers, PII-redacting logger.
2. **Artisan Onboarding & Verification** (`0002_step2_artisan_onboarding.sql`): Explicit face-matching consent screen, NIN + selfie sent only to verification provider (never stored; HMAC `identity_hashes` prevents duplicate NIN accounts), private selfie bucket, Paystack recipient/subaccount code only (never bank details), guarantor SMS privacy notice + OTP confirmation, dual approval gate, and 60-second audited admin signed links.
3. **Location, Online Status & Alerts** (`0003_step3_location_online_alerts.sql`): Approved-only Online switch, 60-second heartbeat, Screen Wake Lock API, 15-minute auto-Offline timeout, single ~100 m rounded PostGIS point (no history), 10 km discovery sorted by distance then rating on Leaflet + OpenStreetMap, Web Push + 30-second atomic SMS backup alerts.
4. **Jobs, Requests & Quotes** (`0004_step4_jobs_requests_quotes.sql`): Direct or nearest-3 60-second waves (up to 3 rounds), atomic single-UPDATE first-to-accept race guard, `sharp` EXIF stripping & `<= 300 KB` compression, exact address hidden via RLS until acceptance, whole-kobo immutable quotes, hash-only 4-digit start code, Share Job (`/track/[token]`), SOS (`112` + trusted contact), Terms cancel fee after `en_route`.
5. **Chat** (`0005_step5_chat_report_block.sql`): Accepted-only Supabase Realtime in-app chat, automatic 7-day closure after job end, Report & Block buttons, zero phone-number exposure.
6. **Payments** (`0006_step6_payments_disputes_reconciliation.sql`): Pay-after-job Paystack checkout with artisan subaccount + 15% commission, HMAC-SHA512 webhook handler with `webhook_events` deduplication & strict amount check, first-time customer cap, disputes pausing release, 24-hour auto-confirm cron, and daily Paystack reconciliation report (`/admin/reconciliation`).
7. **Ratings** (`0007_step7_ratings_reviews.sql`): Confirmed-only 1–5 star ratings + optional comment, unique per side per job, server-recalculated averages & counts, and public artisan profiles (`/artisans/[artisanId]`).
8. **Privacy, Data Download & Account Deletion** (`0008_step8_privacy_deletion.sql`): `/settings` (Download My Data JSON, Artisan Pause/Resume, Delete My Account), unauthenticated `/delete-account` with OTP, active job / pending payment / open dispute blockers, immediate soft-delete + session logout + push/trusted wipe, 30-day permanent erasure of DB/storage/auth user, review anonymisation, 6-year anonymised payment archive, 5-year fraud/violence ban hashes, and non-PII `deletion_logs`.
9. **Admin Dashboard** (`0009_step9_admin_dashboard_mfa.sql`): RFC 6238 TOTP two-step admin login (`/admin/mfa`), unified `/admin` dashboard (pending approvals, users, jobs, disputes, reports, audit log), immediate urgent safety suspensions with 2-business-day human review SLA, dispute resolution, account removal, and `audit_log` coverage for every admin action.

## Running Migrations & Tests

1. Copy `.env.example` to `.env.local` and populate your Supabase, Paystack, Turnstile, SMS, VAPID, and HMAC secrets.
2. Apply migrations `0001` through `0009` in order inside `supabase/migrations/`.
3. Run the automated tests:
   ```bash
   npm test                # Unit, EXIF-strip, TOTP, webhook HMAC & migration static security tests
   npm run test:rls        # Live Step 1 RLS test
   npm run test:rls:step2  # Live Step 2 RLS, duplicate-NIN, dual-approval & audit test
   npm run test:rls:step3  # Live Step 3 RLS, ~100m rounding, 10 km discovery & 30s SMS fallback test
   npm run test:rls:step4  # Live Step 4 RLS, exact-address gating & simultaneous 2-artisan accept race test
   npm run test:rls:step5  # Live Step 5 RLS, accepted-only chat, 7-day close, Report & Block test
   npm run test:rls:step6  # Live Step 6 RLS, duplicate-webhook idempotency, amount check & 24h auto-confirm test
   npm run test:rls:step7  # Live Step 7 RLS, confirmed-only rating & unique per-side review test
   npm run test:rls:step8  # Live Step 8 full end-to-end deletion, anonymisation, 6y archive & 5y ban test
   npm run test:rls:step9  # Live Step 9 RLS, urgent safety suspension, dispute/report resolution & audit log test
   ```
   Standalone rolled-back SQL self-tests for every step are also available in `supabase/tests/rls_step1.sql` through `supabase/tests/rls_step9.sql`.
