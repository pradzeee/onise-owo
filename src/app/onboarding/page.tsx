import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock, ShieldCheck, Sparkles } from "lucide-react";
import { Header } from "@/components/Header";
import { OnboardingForm } from "@/components/OnboardingForm";
import { APP_NAME } from "@/lib/constants";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Finish setting up your account",
};

export default async function OnboardingPage() {
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

  if (profile?.role) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#F8FAF9]">
      <Header isAuthenticated />

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-8 sm:py-12">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-[#EBF7F2] px-3 py-1 text-xs font-bold text-[#08523B]">
            <Sparkles className="h-3.5 w-3.5 text-[#0B6E4F]" />
            Final step — Account setup
          </div>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">
            Welcome to {APP_NAME}
          </h1>
          <p className="mt-1.5 text-xs text-gray-500 sm:text-sm">
            Tell us how you&apos;ll use the platform and confirm our legal terms.
          </p>
        </div>

        <OnboardingForm />

        <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-[11px] font-medium text-gray-500">
          <span className="flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5 text-[#0B6E4F]" />
            Identity Verified
          </span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <Lock className="h-3.5 w-3.5 text-[#0B6E4F]" />
            Paystack Escrow
          </span>
          <span>•</span>
          <Link href="/privacy" className="underline hover:text-gray-700">
            NDPA 2023 Compliant
          </Link>
        </div>
      </main>
    </div>
  );
}
