import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/Header";
import { JobDetailClient } from "@/components/JobDetailClient";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Job Details",
};

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
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

  const { jobId } = await params;

  return (
    <div className="flex min-h-dvh flex-col">
      <Header isAuthenticated roleLabel={profile?.role ?? null} />

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-4 py-6 sm:py-8">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to jobs
        </Link>

        <JobDetailClient jobId={jobId} />
      </main>
    </div>
  );
}
