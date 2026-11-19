import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Briefcase, PlusCircle } from "lucide-react";
import { Header } from "@/components/Header";
import type { JobRecord, JobRequestRecord } from "@/lib/constants";
import { processDueJobDispatchRounds } from "@/lib/dispatch";
import { formatKoboAsNaira } from "@/lib/money";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";
import { formatLagosDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Jobs & Requests",
};

export default async function JobsListPage() {
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
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.role) {
    redirect("/onboarding");
  }

  await processDueJobDispatchRounds().catch(() => {});

  const [{ data: jobsData }, { data: requestsData }] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, customer_id, artisan_id, trade, description, approx_area_label, dispatch_mode, dispatch_round, status, accepted_amount_kobo, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(30),
    profile.role === "artisan"
      ? supabase
          .from("job_requests")
          .select("id, job_id, artisan_id, round_number, status, sent_at, expires_at")
          .eq("artisan_id", user.id)
          .order("sent_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
  ]);

  const jobs = (jobsData ?? []) as JobRecord[];
  const requests = (requestsData ?? []) as JobRequestRecord[];
  const pendingRequests = requests.filter((r) => r.status === "sent");

  return (
    <div className="flex min-h-dvh flex-col">
      <Header isAuthenticated roleLabel={profile.role} />

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to dashboard
            </Link>
            <h1 className="mt-2 flex items-center gap-2 text-2xl font-extrabold text-gray-900">
              <Briefcase className="h-5 w-5 text-[#0B6E4F]" />
              Jobs &amp; Requests
            </h1>
          </div>

          {profile.role === "customer" ? (
            <Link
              href="/jobs/new"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#0B6E4F] px-4 py-2 text-xs font-bold text-white hover:bg-[#08523B]"
            >
              <PlusCircle className="h-4 w-4" />
              New job request
            </Link>
          ) : null}
        </div>

        {/* Incoming pending requests for artisans */}
        {profile.role === "artisan" && pendingRequests.length > 0 ? (
          <section className="space-y-3 rounded-2xl border-2 border-[#0B6E4F] bg-[#EBF7F2]/50 p-4">
            <h2 className="text-sm font-bold text-[#08523B]">
              Incoming Requests ({pendingRequests.length}) — First to accept wins!
            </h2>
            <div className="space-y-2">
              {pendingRequests.map((req) => (
                <Link
                  key={req.id}
                  href={`/jobs/${req.job_id}`}
                  className="flex items-center justify-between rounded-xl border border-emerald-200 bg-white p-3.5 text-xs hover:bg-gray-50"
                >
                  <div>
                    <p className="font-bold text-gray-900">
                      Round {req.round_number} request • Open to accept
                    </p>
                    <p className="mt-0.5 text-gray-500">
                      Sent {formatLagosDateTime(req.sent_at)}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 font-bold text-[#0B6E4F]">
                    Review
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* Jobs list */}
        <section className="space-y-3">
          {jobs.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-600">
              No jobs yet.{" "}
              {profile.role === "customer" ? (
                <Link href="/jobs/new" className="font-bold text-[#0B6E4F] underline">
                  Create your first job request
                </Link>
              ) : (
                "Go Online on your dashboard to receive nearby job requests."
              )}
            </div>
          ) : (
            jobs.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="block rounded-2xl border border-gray-200 bg-white p-4 shadow-xs transition hover:border-[#0B6E4F]/50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full bg-[#EBF7F2] px-2.5 py-0.5 text-xs font-bold capitalize text-[#08523B]">
                    {job.trade.replace("_", " ")}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-gray-800">
                    {job.status.replace("_", " ")}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-medium text-gray-900">
                  {job.description}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                  <span>
                    {job.approx_area_label} • {formatLagosDateTime(job.created_at)}
                  </span>
                  {job.accepted_amount_kobo ? (
                    <span className="font-bold text-gray-900">
                      {formatKoboAsNaira(job.accepted_amount_kobo)}
                    </span>
                  ) : null}
                </div>
              </Link>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
