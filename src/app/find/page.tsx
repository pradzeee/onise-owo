import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import { FindArtisansClient } from "@/components/FindArtisansClient";
import { Header } from "@/components/Header";
import { TRADES, type ArtisanTrade } from "@/lib/constants";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Find Nearby Verified Artisans",
};

export default async function FindArtisansPage({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string }>;
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.role) {
    redirect("/onboarding");
  }

  const sp = await searchParams;
  const initialTrade = TRADES.some((t) => t.id === sp.trade)
    ? (sp.trade as ArtisanTrade)
    : "plumber";

  return (
    <div className="flex min-h-dvh flex-col bg-[#F8FAF9]">
      <Header isAuthenticated roleLabel={profile.role} />

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
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
              <Search className="h-4.5 w-4.5" />
            </span>
            <div>
              <h1 className="text-xl font-black tracking-tight text-gray-900 sm:text-2xl">
                Find Nearby Verified Artisans
              </h1>
              <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">
                Showing verified, Online artisans within 10 km, sorted by distance then rating.
              </p>
            </div>
          </div>
        </div>

        <FindArtisansClient initialTrade={initialTrade} />
      </main>
    </div>
  );
}
