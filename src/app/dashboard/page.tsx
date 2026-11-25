import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Briefcase,
  Phone,
  Search,
  Settings,
  ShieldCheck,
  UserCheck,
  Wrench,
} from "lucide-react";
import { ArtisanOnlineSwitch } from "@/components/ArtisanOnlineSwitch";
import { ConsentsManager } from "@/components/ConsentsManager";
import { Header } from "@/components/Header";
import { PushNotificationsCard } from "@/components/PushNotificationsCard";
import { TrustedContactCard } from "@/components/TrustedContactCard";
import {
  TRADES,
  type ConsentRecord,
  type ProfileRecord,
} from "@/lib/constants";
import {
  fetchFirestoreUserProfile,
  getActiveFirebaseSession,
  isFirebaseServerConfigured,
} from "@/lib/firebase/server";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
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
  let userPhone =
    (profile as { phone?: string | null })?.phone || user.phone || previewPhone;
  let artisanTrade = (user.user_metadata as { trade?: string } | undefined)?.trade;

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
          .select("is_online, last_seen_at, verification_status, trade")
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let consents = (consentsData ?? []) as ConsentRecord[];

  // Hydrate live Firebase/Firestore user consents, phone, and trade when active
  if (!isRealSupabaseConfigured() && isFirebaseServerConfigured()) {
    const fbSession = await getActiveFirebaseSession();
    if (fbSession) {
      if (!userPhone && fbSession.phone) userPhone = fbSession.phone;
      if (!artisanTrade && fbSession.trade) artisanTrade = fbSession.trade;
      if (fbSession.idToken) {
        const fsProfile = await fetchFirestoreUserProfile(
          fbSession.uid,
          fbSession.idToken,
        );
        if (fsProfile) {
          if (fsProfile.phone) userPhone = fsProfile.phone;
          if (fsProfile.trade) artisanTrade = fsProfile.trade;
          const entries = Object.entries(fsProfile.consents ?? {});
          if (entries.length > 0) {
            const ts = fsProfile.updatedAt || fsProfile.createdAt;
            consents = entries
              .filter(([, granted]) => typeof granted === "boolean")
              .map(([consentType, granted]) => ({
                id: `fs-${fsProfile.uid}-${consentType}`,
                user_id: fsProfile.uid,
                consent_type: consentType as ConsentRecord["consent_type"],
                version: fsProfile.acceptedTermsVersion || "2026-11-v1",
                granted: Boolean(granted),
                consented_at: ts,
                withdrawn_at: granted ? null : ts,
                created_at: ts,
              }));
          }
        }
      }
    }
  }

  const resolvedTradeId = artisanData?.trade ?? artisanTrade;
  const resolvedTradeLabel =
    TRADES.find((t) => t.id === resolvedTradeId)?.label ?? resolvedTradeId;

  const hasLocationConsent = consents.some(
    (c) => c.consent_type === "location" && c.granted && !c.withdrawn_at,
  );

  return (
    <div className="flex min-h-dvh flex-col bg-[#F8FAF9]">
      <Header isAuthenticated roleLabel={profile.role} />

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <section className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#0B6E4F]">
                Signed in
              </p>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">
                {profile.display_name
                  ? profile.display_name
                  : profile.role === "artisan"
                    ? "Artisan Account"
                    : profile.role === "admin"
                      ? "Admin Account"
                      : "Customer Account"}
              </h1>
              {user.email ? (
                <p className="mt-0.5 text-xs text-gray-500">{user.email}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {profile.role === "artisan" && resolvedTradeLabel ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-bold text-[#08523B]">
                  <Wrench className="h-3.5 w-3.5 text-[#0B6E4F]" aria-hidden="true" />
                  {resolvedTradeLabel}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EBF7F2] px-3 py-1 text-xs font-bold capitalize text-[#08523B]">
                <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {profile.account_status}
              </span>
            </div>
          </div>

          <dl className="mt-5 grid gap-3 border-t border-gray-100 pt-4 text-xs sm:grid-cols-3">
            <div className="rounded-xl border border-gray-100 bg-[#F8FAF9] p-3.5">
              <dt className="font-medium text-gray-500">Account role</dt>
              <dd className="mt-1 text-sm font-bold capitalize text-gray-900">
                {profile.role}
                {profile.role === "artisan" && resolvedTradeLabel
                  ? ` • ${resolvedTradeLabel}`
                  : ""}
              </dd>
            </div>
            <div className="rounded-xl border border-gray-100 bg-[#F8FAF9] p-3.5">
              <dt className="font-medium text-gray-500">Verification</dt>
              <dd className="mt-1 text-sm font-bold capitalize text-gray-900">
                {profile.verification_status}
              </dd>
            </div>
            <div className="rounded-xl border border-gray-100 bg-[#F8FAF9] p-3.5">
              <dt className="font-medium text-gray-500">Rating</dt>
              <dd className="mt-1 text-sm font-bold text-gray-900">
                {profile.rating_count > 0
                  ? `★ ${Number(profile.rating_avg).toFixed(2)} (${profile.rating_count})`
                  : "No reviews yet"}
                {profile.role === "artisan" && profile.verification_status === "approved" ? (
                  <Link
                    href={`/artisans/${user.id}`}
                    className="ml-2 text-xs font-semibold text-[#0B6E4F] underline"
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
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-blue-700"
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
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#0B6E4F] px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-[#08523B]"
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
                  className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#0B6E4F] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#08523B]"
                >
                  Admin Dashboard
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/admin/verifications"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-xs font-bold text-amber-950 hover:bg-amber-100"
                >
                  Verifications
                </Link>
                <Link
                  href="/admin/reconciliation"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-xs font-bold text-amber-950 hover:bg-amber-100"
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
                  className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#0B6E4F] px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-[#08523B]"
                >
                  Find artisans
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/jobs/new"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[#0B6E4F] bg-white px-4 py-2 text-xs font-bold text-[#0B6E4F] transition hover:bg-[#EBF7F2]"
                >
                  New request
                </Link>
              </div>
            </div>
          )}
        </section>

        {/* Quick Navigation Grid */}
        <section className="grid gap-3.5 sm:grid-cols-2">
          <Link
            href="/jobs"
            className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs transition hover:-translate-y-0.5 hover:border-[#0B6E4F]/50 hover:shadow-md"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EBF7F2] text-[#0B6E4F]">
                <Briefcase className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-sm font-bold text-gray-900">Jobs &amp; Requests</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  {profile.role === "artisan"
                    ? "Incoming requests, Naira quotes & start codes."
                    : "Track requests, quotes, start codes & share status."}
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-[#0B6E4F]" />
          </Link>

          <Link
            href="/settings"
            className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs transition hover:-translate-y-0.5 hover:border-[#0B6E4F]/50 hover:shadow-md"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EBF7F2] text-[#0B6E4F]">
                <Settings className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-sm font-bold text-gray-900">Account &amp; Phone Settings</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  Update phone number, download data, or manage privacy.
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-[#0B6E4F]" />
          </Link>
        </section>

        {/* Artisan Online/Offline switch */}
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

        {/* Trusted contact & Notifications & Consents */}
        <TrustedContactCard />
        <PushNotificationsCard />
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
