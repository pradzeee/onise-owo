import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Settings } from "lucide-react";
import { Header } from "@/components/Header";
import { SettingsClient } from "@/components/SettingsClient";
import type { ProfileRecord } from "@/lib/constants";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy & Account Settings",
};

export default async function SettingsPage() {
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

  const { data: profileData } = await supabase
    .from("profiles")
    .select("role, account_status")
    .eq("id", user.id)
    .maybeSingle();

  const profile = profileData as Pick<ProfileRecord, "role" | "account_status"> | null;
  if (!profile?.role) {
    redirect("/onboarding");
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <Header isAuthenticated roleLabel={profile.role} />

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-6 sm:py-8">
        <div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-extrabold text-gray-900">
            <Settings className="h-5 w-5 text-[#0B6E4F]" />
            Privacy &amp; Account Settings
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Download a copy of your data, pause your artisan listing, or permanently
            delete your account.
          </p>
        </div>

        <SettingsClient
          role={profile.role}
          initialAccountStatus={profile.account_status}
        />

        <div className="flex flex-wrap gap-4 text-xs text-gray-500">
          <Link href="/privacy" className="underline hover:text-gray-800">
            Privacy Policy
          </Link>
          <Link href="/terms" className="underline hover:text-gray-800">
            Terms of Service
          </Link>
          <Link href="/delete-account" className="underline hover:text-gray-800">
            Delete Account (without login)
          </Link>
        </div>
      </main>
    </div>
  );
}
