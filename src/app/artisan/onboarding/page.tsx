import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock, ShieldAlert, ShieldCheck } from "lucide-react";
import { ArtisanOnboardingForm } from "@/components/ArtisanOnboardingForm";
import { Header } from "@/components/Header";
import {
  TRADES,
  type ArtisanProfileRecord,
  type ArtisanTrade,
  type ArtisanVerificationRecord,
  type GuarantorVerificationRecord,
} from "@/lib/constants";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";
import { formatLagosDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Artisan Verification",
};

export default async function ArtisanOnboardingPage() {
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name, verification_status, account_status")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.role) {
    redirect("/onboarding");
  }

  if (profile.role !== "artisan") {
    redirect("/dashboard");
  }

  const [{ data: artisanData }, { data: verifData }, { data: guarantorData }] =
    await Promise.all([
      supabase
        .from("artisan_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("artisan_verifications")
        .select(
          "id, user_id, provider_name, provider_reference, provider_status, liveness_passed, face_match_passed, checked_at, created_at, updated_at",
        )
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("guarantor_verifications")
        .select("id, artisan_id, guarantor_name, status, confirmed_at, sms_sent_at, created_at, updated_at")
        .eq("artisan_id", user.id)
        .maybeSingle(),
    ]);

  const artisan = artisanData as ArtisanProfileRecord | null;
  const verification = verifData as ArtisanVerificationRecord | null;
  const guarantor = guarantorData as GuarantorVerificationRecord | null;

  const canSubmitForm =
    !artisan ||
    artisan.verification_status === "unverified" ||
    artisan.verification_status === "rejected" ||
    verification?.provider_status === "failed";

  const metaTrade = (user.user_metadata as { trade?: string } | undefined)?.trade;
  const defaultTrade = TRADES.some((t) => t.id === (artisan?.trade ?? metaTrade))
    ? ((artisan?.trade ?? metaTrade) as ArtisanTrade)
    : "plumber";
  const defaultName =
    artisan?.full_name ??
    profile.display_name ??
    (user.user_metadata as { display_name?: string } | undefined)?.display_name ??
    "";

  return (
    <div className="flex min-h-dvh flex-col bg-[#F8FAF9]">
      <Header isAuthenticated roleLabel="artisan" />

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs sm:p-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-200 hover:text-gray-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </Link>
          <div className="mt-3 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EBF7F2] text-[#0B6E4F]">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-xl font-black tracking-tight text-gray-900 sm:text-2xl">
                Artisan Verification
              </h1>
              <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">
                Complete your profile, NIN face match &amp; liveness check, payout setup, and
                guarantor confirmation. Only approved artisans can go Online.
              </p>
            </div>
          </div>
        </div>

        {/* Live verification progress summary if submitted */}
        {artisan ? (
          <section className="space-y-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-gray-900">
                Current Verification Status
              </h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${
                  artisan.verification_status === "approved"
                    ? "bg-emerald-100 text-emerald-800"
                    : artisan.verification_status === "rejected" ||
                        artisan.verification_status === "suspended"
                      ? "bg-red-100 text-red-800"
                      : "bg-amber-100 text-amber-800"
                }`}
              >
                {artisan.verification_status}
              </span>
            </div>

            {artisan.rejection_reason ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-800">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-bold">Admin review note:</p>
                  <p className="mt-0.5">{artisan.rejection_reason}</p>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 text-xs sm:grid-cols-3">
              <div className="rounded-xl bg-[#F8FAF9] p-3">
                <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                  {verification?.provider_status === "passed" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Clock className="h-4 w-4 text-amber-600" />
                  )}
                  NIN + Face Match
                </div>
                <p className="mt-1 capitalize text-gray-600">
                  {verification?.provider_status ?? "Not checked"}
                </p>
              </div>

              <div className="rounded-xl bg-[#F8FAF9] p-3">
                <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                  {guarantor?.status === "confirmed" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Clock className="h-4 w-4 text-amber-600" />
                  )}
                  Guarantor
                </div>
                <p className="mt-1 capitalize text-gray-600">
                  {guarantor
                    ? `${guarantor.guarantor_name} — ${guarantor.status}`
                    : "Pending"}
                </p>
                {guarantor?.confirmed_at ? (
                  <p className="mt-0.5 text-[10px] text-gray-500">
                    {formatLagosDateTime(guarantor.confirmed_at)}
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl bg-[#F8FAF9] p-3">
                <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                  {artisan.payout_recipient_code ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Clock className="h-4 w-4 text-amber-600" />
                  )}
                  Payout Setup
                </div>
                <p className="mt-1 font-mono text-[11px] text-gray-600">
                  {artisan.payout_recipient_code ?? "Pending"}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {canSubmitForm ? (
          <ArtisanOnboardingForm
            initialFullName={defaultName}
            initialTrade={defaultTrade}
            initialBio={artisan?.bio ?? ""}
            initialWorkArea={artisan?.work_area ?? ""}
          />
        ) : null}
      </main>
    </div>
  );
}
