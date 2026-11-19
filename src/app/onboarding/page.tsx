import type { Metadata } from "next";
import { redirect } from "next/navigation";
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
    <div className="flex min-h-dvh flex-col">
      <Header isAuthenticated />

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-8">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#0B6E4F]">
            Step 1 of 1 — Account setup
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-gray-900">
            Welcome to {APP_NAME}
          </h1>
          <p className="mt-1.5 text-sm text-gray-600">
            Tell us how you&apos;ll use the platform and confirm our legal terms.
          </p>
        </div>

        <OnboardingForm />
      </main>
    </div>
  );
}
