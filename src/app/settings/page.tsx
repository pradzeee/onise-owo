import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Settings } from "lucide-react";
import { Header } from "@/components/Header";
import { SettingsClient } from "@/components/SettingsClient";
import type { ProfileRecord } from "@/lib/constants";
import {
  fetchFirestoreUserProfile,
  getActiveFirebaseSession,
  isFirebaseServerConfigured,
} from "@/lib/firebase/server";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
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

  const cookieStore = await cookies();
  let initialPhone = user.phone ?? cookieStore.get("onise_user_phone")?.value ?? null;

  if (!isRealSupabaseConfigured() && isFirebaseServerConfigured()) {
    const fbSession = await getActiveFirebaseSession();
    if (fbSession) {
      if (!initialPhone && fbSession.phone) initialPhone = fbSession.phone;
      if (fbSession.idToken) {
        const fsProfile = await fetchFirestoreUserProfile(
          fbSession.uid,
          fbSession.idToken,
        );
        if (fsProfile?.phone) initialPhone = fsProfile.phone;
      }
    }
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
    <div className="flex min-h-dvh flex-col bg-[#F8FAF9]">
      <Header isAuthenticated roleLabel={profile.role} />

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs sm:p-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-200 hover:text-gray-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </Link>
          <h1 className="mt-3 flex items-center gap-2 text-xl font-black tracking-tight text-gray-900 sm:text-2xl">
            <Settings className="h-5 w-5 text-[#0B6E4F]" />
            Privacy &amp; Account Settings
          </h1>
          <p className="mt-1 text-xs text-gray-500 sm:text-sm">
            Manage your Nigerian phone number, download your data, pause listings, or delete your account.
          </p>
        </div>

        <SettingsClient
          role={profile.role}
          initialAccountStatus={profile.account_status}
          initialPhone={initialPhone}
        />

        <div className="flex flex-wrap gap-4 px-1 text-xs text-gray-500">
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
