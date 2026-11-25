import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { AccountDeletionFlow } from "@/components/AccountDeletionFlow";

export const metadata: Metadata = {
  title: "Delete Account",
};

/**
 * Public account deletion page — works WITHOUT login and confirms with an SMS OTP.
 */
export default function PublicDeleteAccountPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-[#F8FAF9]">
      <Header />

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs sm:p-6">
          <p className="text-xs font-bold uppercase tracking-wider text-red-700">
            NDPA 2023 Right to Erasure • No login required
          </p>
          <h1 className="mt-1.5 text-2xl font-black tracking-tight text-gray-900">
            Delete your Oníṣẹ́ ọwọ́ account
          </h1>
          <p className="mt-1.5 text-sm text-gray-600">
            You can request permanent account deletion right here without signing in.
            We&apos;ll verify your identity with a one-time SMS code sent to your
            registered Nigerian mobile number.
          </p>
        </div>

        <AccountDeletionFlow mode="public" />

        <div className="flex flex-wrap gap-4 text-xs text-gray-500">
          <Link href="/privacy" className="underline hover:text-gray-800">
            Privacy Policy
          </Link>
          <Link href="/terms" className="underline hover:text-gray-800">
            Terms of Service
          </Link>
          <Link href="/login" className="underline hover:text-gray-800">
            Sign in instead
          </Link>
        </div>
      </main>
    </div>
  );
}
