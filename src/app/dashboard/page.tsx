import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Briefcase, Phone, Search, ShieldCheck, UserCheck } from "lucide-react";
import { ArtisanOnlineSwitch } from "@/components/ArtisanOnlineSwitch";
import { ConsentsManager } from "@/components/ConsentsManager";
import { Header } from "@/components/Header";
import { PushNotificationsCard } from "@/components/PushNotificationsCard";
import { TrustedContactCard } from "@/components/TrustedContactCard";
import type { ConsentRecord, ProfileRecord } from "@/lib/constants";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  if (!isSupabaseServerConfigured()) {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  const profile = profileData as ProfileRecord | null;
  if (!profile?.role) {
    redirect("/onboarding");
  }

  const cookieStore = await cookies();
  const previewPhone = cookieStore.get("onise_user_phone")?.value;
  const userPhone = (profile as { phone?: string | null })?.phone || user.phone || previewPhone;

  const [{ data: consentsData }, { data: artisanData }] = await Promise.all([
    supabase
      .from("consents")
      .select(
        "id, user_id, consent_type, version, granted, consented_at, withdrawn_at, created_at",
      )
      .eq("user_id", user.id)
      .order("consented_at", { ascending: false }),
    profile.role === "artisan"
      ? supabase
          .from("artisan_profiles")
          .select("is_online, last_seen_at, verification_status")
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const consents = (consentsData ?? []) as ConsentRecord[];
  const hasLocationConsent = consents.some(
    (c) => c.consent_type === "location" && c.granted && !c.withdrawn_at,
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <Header isAuthenticated roleLabel={profile.role} />

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6 sm:py-8">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[#0B6E4F]">
                Signed in
              </p>
              <h1 className="mt-1 text-xl font-extrabold text-gray-900 sm:text-2xl">
                {profile.display_name
                  ? profile.display_name
                  : profile.role === "artisan"
                    ? "Artisan Account"
                    : profile.role === "admin"
                      ? "Admin Account"
                      : "Customer Account"}
              </h1>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EBF7F2] px-3 py-1 text-xs font-semibold capitalize text-[#08523B]">
              <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Status: {profile.account_status}
            </span>
          </div>

          <dl className="mt-4 grid gap-3 border-t border-gray-100 pt-4 text-xs sm:grid-cols-3">
            <div className="rounded-xl bg-gray-50 p-3">
              <dt className="text-gray-500">Account role</dt>
              <dd className="mt-0.5 font-bold capitalize text-gray-900">{profile.role}</dd>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <dt className="text-gray-500">Verification</dt>
              <dd className="mt-0.5 font-bold capitalize text-gray-900">
                {profile.verification_status}
              </dd>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <dt className="text-gray-500">Rating</dt>
              <dd className="mt-0.5 font-bold text-gray-900">
                {profile.rating_count > 0
                  ? `★ ${Number(profile.rating_avg).toFixed(2)} (${profile.rating_count})`
                  : "No reviews yet"}
                {profile.role === "artisan" && profile.verification_status === "approved" ? (
                  <Link
                    href={`/artisans/${user.id}`}
                    className="ml-2 font-medium text-[#0B6E4F] underline"
                  >
                    View profile
                  </Link>
                ) : null}
              </dd>
            </div>
          </dl>

          {/* Missing phone number reminder banner */}
          {!userPhone && (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5 text-xs text-blue-950">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                <div>
                  <p className="font-bold">Add your Nigerian Phone Number</p>
                  <p className="mt-0.5 text-blue-800">
                    Add your mobile number in Settings to receive SMS alerts and allow contacts to reach you for jobs.
                  </p>
                </div>
              </div>
              <Link
                href="/settings"
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Add Phone
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}

          {/* Role-specific primary action banner */}
          {profile.role === "artisan" ? (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-[#EBF7F2]/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5 text-xs text-[#08523B]">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-bold">
                    {profile.verification_status === "approved"
                      ? "You are a verified artisan!"
                      : profile.verification_status === "pending"
                        ? "Verification in progress"
                        : "Complete Artisan Verification"}
                  </p>
                  <p className="mt-0.5">
                    {profile.verification_status === "approved"
                      ? "Switch Online below to appear in nearby customer searches within 10 km."
                      : "Only approved artisans can go Online. Submit your NIN face match, payout details, and guarantor confirmation."}
                  </p>
                </div>
              </div>
              <Link
                href="/artisan/onboarding"
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#0B6E4F] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#08523B]"
              >
                {profile.verification_status === "unverified"
                  ? "Start verification"
                  : "View verification"}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : profile.role === "admin" ? (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5 text-xs text-amber-950">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                <div>
                  <p className="font-bold">Admin Review Queue</p>
                  <p className="mt-0.5">
                    Review artisan verification applications, inspect private selfies via
                    60-second audited links, and approve or reject with reasons.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/admin"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#0B6E4F] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#08523B]"
                >
                  Admin Dashboard
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/admin/verifications"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3.5 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-100"
                >
                  Verifications
                </Link>
                <Link
                  href="/admin/reconciliation"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3.5 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-100"
                >
                  Reconciliation
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-[#EBF7F2]/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5 text-xs text-[#08523B]">
                <Search className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-bold">Find nearby verified artisans</p>
                  <p className="mt-0.5">
                    Pick a trade to see verified, Online artisans within 10 km on the map,
                    sorted by distance and rating.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/find"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#0B6E4F] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#08523B]"
                >
                  Find artisans
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/jobs/new"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#0B6E4F] bg-white px-3.5 py-2 text-xs font-semibold text-[#0B6E4F] hover:bg-[#EBF7F2]"
                >
                  New request
                </Link>
              </div>
            </div>
          )}
        </section>

        {/* Step 4: Jobs & Requests Inbox shortcut */}
        <section className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <Briefcase className="mt-0.5 h-5 w-5 shrink-0 text-[#0B6E4F]" />
            <div>
              <h2 className="text-base font-bold text-gray-900">Jobs &amp; Requests</h2>
              <p className="mt-0.5 text-xs text-gray-600">
                {profile.role === "artisan"
                  ? "View incoming nearest-3 / direct requests, send quotes in Naira, and enter customer start codes."
                  : "Track your active job requests, review artisan quotes, view your 4-digit start code, or share live job status."}
              </p>
            </div>
          </div>
          <Link
            href="/jobs"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#0B6E4F] px-4 py-2 text-xs font-bold text-white hover:bg-[#08523B]"
          >
            Open Jobs
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>

        {/* Step 3: Artisan Online/Offline switch with 60s heartbeat + Wake Lock */}
        {profile.role === "artisan" ? (
          <ArtisanOnlineSwitch
            verificationStatus={
              (artisanData?.verification_status as ProfileRecord["verification_status"]) ??
              profile.verification_status
            }
            initialIsOnline={Boolean(artisanData?.is_online)}
            initialLastSeenAt={artisanData?.last_seen_at ?? null}
            initialHasLocationConsent={hasLocationConsent}
          />
        ) : null}

        {/* Step 4: Trusted contact for Share Job & SOS */}
        <TrustedContactCard />

        {/* Step 3: Web Push + 30s SMS Backup Alerts */}
        <PushNotificationsCard />

        {/* Step 1: Separate withdrawable consents */}
        <ConsentsManager role={profile.role} initialConsents={consents} />

        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-gray-500">
          <span>All dates shown in Africa/Lagos (WAT). Stored in UTC.</span>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/settings" className="font-semibold text-[#0B6E4F] underline hover:text-[#08523B]">
              Settings (Download / Pause / Delete)
            </Link>
            <Link href="/terms" className="underline hover:text-gray-800">
              Terms of Service
            </Link>
            <Link href="/privacy" className="underline hover:text-gray-800">
              Privacy Policy
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
