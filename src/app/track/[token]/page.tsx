import type { Metadata } from "next";
import { Clock, ShieldCheck } from "lucide-react";
import { Header } from "@/components/Header";
import { hashJobShareToken } from "@/lib/jobs";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { formatLagosDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live Job Safety Share",
};

export default async function TrackSharedJobPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isSupabaseAdminConfigured() || !token || token.length < 16) {
    return (
      <div className="flex min-h-dvh flex-col">
        <Header />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-bold text-gray-900">Invalid tracking link</h1>
            <p className="mt-2 text-sm text-gray-600">
              This safety share link is invalid or has expired.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const admin = createSupabaseAdminClient();
  const tokenHash = hashJobShareToken(token);

  const { data: share } = await admin
    .from("job_shares")
    .select("job_id, expires_at")
    .eq("share_token_hash", tokenHash)
    .maybeSingle();

  if (!share || new Date(share.expires_at).getTime() < Date.now()) {
    return (
      <div className="flex min-h-dvh flex-col">
        <Header />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-bold text-gray-900">Share link expired</h1>
            <p className="mt-2 text-sm text-gray-600">
              Safety tracking links expire automatically after 24 hours.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const { data: job } = await admin
    .from("jobs")
    .select(
      "trade, approx_area_label, status, artisan_id, accepted_at, en_route_at, arrived_at, started_at, completed_at, updated_at",
    )
    .eq("id", share.job_id)
    .maybeSingle();

  let artisanName = "Pending assignment";
  if (job?.artisan_id) {
    const { data: art } = await admin
      .from("artisan_profiles")
      .select("full_name")
      .eq("user_id", job.artisan_id)
      .maybeSingle();
    if (art?.full_name) artisanName = art.full_name;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-8">
        <div className="space-y-4 rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#0B6E4F]">
            <ShieldCheck className="h-4 w-4" />
            Oníṣẹ́ ọwọ́ Safety Tracking
          </div>

          <h1 className="text-xl font-extrabold capitalize text-gray-900">
            Status: {job?.status?.replace("_", " ") ?? "Unknown"}
          </h1>

          <dl className="grid gap-3 rounded-xl bg-gray-50 p-4 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-gray-500">Trade</dt>
              <dd className="mt-0.5 font-bold capitalize text-gray-900">
                {job?.trade?.replace("_", " ") ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Verified Artisan</dt>
              <dd className="mt-0.5 font-bold text-gray-900">{artisanName}</dd>
            </div>
            <div>
              <dt className="text-gray-500">General Area</dt>
              <dd className="mt-0.5 font-bold text-gray-900">
                {job?.approx_area_label ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1 text-gray-500">
                <Clock className="h-3 w-3" />
                Last Updated (Lagos)
              </dt>
              <dd className="mt-0.5 font-bold text-gray-900">
                {formatLagosDateTime(job?.updated_at)}
              </dd>
            </div>
          </dl>

          <p className="text-xs text-gray-500">
            If you believe your contact is in danger, call Nigeria Emergency{" "}
            <a href="tel:112" className="font-bold text-red-700 underline">
              112
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
