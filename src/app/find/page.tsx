import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import { FindArtisansClient } from "@/components/FindArtisansClient";
import { Header } from "@/components/Header";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Find Nearby Verified Artisans",
};

export default async function FindArtisansPage() {
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

  return (
    <div className="flex min-h-dvh flex-col">
      <Header isAuthenticated roleLabel={profile.role} />

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-6 sm:py-8">
        <div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </Link>
          <div className="mt-2 flex items-center gap-2">
            <Search className="h-5 w-5 text-[#0B6E4F]" />
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">
              Find Nearby Verified Artisans
            </h1>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Showing verified, Online artisans within 10 km, sorted by distance then
            rating.
          </p>
        </div>

        <FindArtisansClient />
      </main>
    </div>
  );
}
