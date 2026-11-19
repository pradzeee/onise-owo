import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, MapPin, ShieldCheck, Star } from "lucide-react";
import { Header } from "@/components/Header";
import type { ArtisanPublicProfile, ReviewRecord } from "@/lib/constants";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";
import { formatLagosDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Artisan Profile",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ArtisanPublicProfilePage({
  params,
}: {
  params: Promise<{ artisanId: string }>;
}) {
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

  const { artisanId } = await params;
  if (!UUID_REGEX.test(artisanId)) {
    redirect("/find");
  }

  const [{ data: viewerProfile }, { data: profileRows }, { data: reviewsData }] =
    await Promise.all([
      supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      supabase.rpc("get_artisan_public_profile", { p_artisan_id: artisanId }),
      supabase
        .from("reviews")
        .select(
          "id, job_id, reviewer_id, reviewee_id, reviewer_role, reviewer_display_name, rating, comment, is_anonymized, created_at",
        )
        .eq("reviewee_id", artisanId)
        .eq("reviewer_role", "customer")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  const artisan = (
    Array.isArray(profileRows) ? profileRows[0] : profileRows
  ) as ArtisanPublicProfile | null;

  if (!artisan) {
    return (
      <div className="flex min-h-dvh flex-col">
        <Header isAuthenticated roleLabel={viewerProfile?.role ?? null} />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-bold text-gray-900">Artisan not found</h1>
            <p className="mt-2 text-sm text-gray-600">
              This artisan profile is unavailable or not yet verified.
            </p>
            <Link
              href="/find"
              className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-[#0B6E4F] px-4 py-2 text-xs font-semibold text-white"
            >
              Find nearby artisans
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const reviews = (reviewsData ?? []) as ReviewRecord[];
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const photoUrl =
    artisan.photo_path && supabaseUrl
      ? `${supabaseUrl}/storage/v1/object/public/artisan-photos/${artisan.photo_path}`
      : null;

  const initials = artisan.full_name
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex min-h-dvh flex-col">
      <Header isAuthenticated roleLabel={viewerProfile?.role ?? null} />

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-6 sm:py-8">
        <Link
          href="/find"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to nearby artisans
        </Link>

        {/* Artisan Profile Summary */}
        <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-4">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt={artisan.full_name}
                className="h-16 w-16 shrink-0 rounded-full border border-gray-200 object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#EBF7F2] text-lg font-bold text-[#08523B]">
                {initials}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-extrabold text-gray-900">
                  {artisan.full_name}
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Verified
                </span>
                {artisan.is_online ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    Online now
                  </span>
                ) : null}
              </div>

              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span className="font-semibold capitalize text-gray-800">
                  {artisan.trade.replace("_", " ")}
                </span>
                <span>•</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {artisan.work_area}
                </span>
              </p>

              {/* Average rating & count */}
              <div className="mt-2 flex items-center gap-2 text-sm font-bold text-amber-700">
                <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
                {artisan.rating_count > 0 ? (
                  <span>
                    {Number(artisan.rating_avg).toFixed(2)} average ({artisan.rating_count}{" "}
                    verified review{artisan.rating_count === 1 ? "" : "s"})
                  </span>
                ) : (
                  <span className="font-normal text-gray-500">No reviews yet</span>
                )}
              </div>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-gray-700">{artisan.bio}</p>

          {artisan.is_online && viewerProfile?.role === "customer" ? (
            <Link
              href={`/jobs/new?trade=${encodeURIComponent(artisan.trade)}&artisanId=${encodeURIComponent(artisan.artisan_id)}&artisanName=${encodeURIComponent(artisan.full_name)}&area=${encodeURIComponent(artisan.work_area)}`}
              className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-3 text-sm font-bold text-white hover:bg-[#08523B]"
            >
              Request {artisan.full_name}
            </Link>
          ) : null}
        </section>

        {/* Verified Reviews List */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold text-gray-900">
            Verified Customer Reviews ({artisan.rating_count})
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Only customers who completed and confirmed a job can leave a review.
          </p>

          {reviews.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">
              This verified artisan has not received any reviews yet.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-gray-100">
              {reviews.map((rev) => (
                <li key={rev.id} className="py-3.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-gray-900">
                      {rev.is_anonymized ? "Anonymous customer" : rev.reviewer_display_name}
                    </span>
                    <span className="inline-flex items-center gap-1 font-bold text-amber-700">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                      {rev.rating}.0 / 5
                    </span>
                  </div>
                  {rev.comment ? (
                    <p className="mt-1.5 text-sm leading-relaxed text-gray-700">
                      {rev.comment}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-gray-400">
                    {formatLagosDate(rev.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
