import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CreateJobForm } from "@/components/CreateJobForm";
import { Header } from "@/components/Header";
import { TRADES, type ArtisanTrade } from "@/lib/constants";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Request an Artisan",
};

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{
    trade?: string;
    lat?: string;
    lng?: string;
    area?: string;
    artisanId?: string;
    artisanName?: string;
  }>;
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
  const validTrade = TRADES.some((t) => t.id === sp.trade)
    ? (sp.trade as ArtisanTrade)
    : "plumber";
  const parsedLat = sp.lat ? Number(sp.lat) : undefined;
  const parsedLng = sp.lng ? Number(sp.lng) : undefined;

  return (
    <div className="flex min-h-dvh flex-col">
      <Header isAuthenticated roleLabel={profile.role} />

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-4 py-6 sm:py-8">
        <div>
          <Link
            href="/find"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to nearby artisans
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold text-gray-900">
            Create a Job Request
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Describe the job, add up to 3 photos, and pin your address. Your exact street
            address is kept private until an artisan accepts.
          </p>
        </div>

        <CreateJobForm
          initialTrade={validTrade}
          initialLat={Number.isFinite(parsedLat) ? parsedLat : undefined}
          initialLng={Number.isFinite(parsedLng) ? parsedLng : undefined}
          initialArea={sp.area ?? ""}
          targetArtisanId={sp.artisanId}
          targetArtisanName={sp.artisanName}
        />
      </main>
    </div>
  );
}
