import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { APP_NAME, LEGAL_VERSIONS } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-[#F8FAF9]">
      <Header />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <article className="space-y-6 rounded-2xl border border-gray-200/80 bg-white p-6 shadow-sm sm:p-8">
          <div className="border-b border-gray-100 pb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#0B6E4F]">
              NDPA 2023 Aligned • Version {LEGAL_VERSIONS.privacy_policy}
            </p>
            <h1 className="mt-1 text-2xl font-extrabold text-gray-900">
              {APP_NAME} Privacy Policy
            </h1>
            <p className="mt-1 text-xs text-gray-500">
              Nigeria Data Protection Act (NDPA) compliant data handling summary
            </p>
          </div>

          <section className="space-y-2 text-sm leading-relaxed text-gray-700">
            <h2 className="text-base font-bold text-gray-900">1. Data We Collect</h2>
            <p>
              We collect only the minimum personal data needed to operate {APP_NAME}: your
              phone number for OTP login, your selected role, consent records (type,
              version, and UTC timestamp), and—when you choose to use them—rounded location
              (~100 metres, with no location history) and notification preferences.
            </p>
          </section>

          <section className="space-y-2 text-sm leading-relaxed text-gray-700">
            <h2 className="text-base font-bold text-gray-900">
              2. Separate &amp; Withdrawable Consents
            </h2>
            <p>
              Location access, push notifications, and (for artisans) biometric face
              matching each require their own separate consent. You can grant or withdraw
              any of these optional consents at any time from your dashboard.
            </p>
          </section>

          <section className="space-y-2 text-sm leading-relaxed text-gray-700">
            <h2 className="text-base font-bold text-gray-900">
              3. Identity Verification (No NIN Storage)
            </h2>
            <p>
              For artisan verification, your NIN and live selfie are sent directly to our
              licensed verification provider after explicit consent. We never store your
              NIN number or bank account details—only the provider reference, verification
              result, Paystack recipient code, and keyed cryptographic hashes to prevent
              duplicate accounts.
            </p>
          </section>

          <section className="space-y-2 text-sm leading-relaxed text-gray-700">
            <h2 className="text-base font-bold text-gray-900">
              4. Security, Logging &amp; Retention
            </h2>
            <p>
              We never log phone numbers, NINs, home addresses, or chat messages. Every
              database table enforces strict row-level security so other users cannot read
              or alter your personal records. When you delete your account, personal data
              is erased within 30 days; payment accounting records are retained for 6 years
              with your name replaced by an anonymous ID as required by law.
            </p>
          </section>

          <div className="flex flex-wrap items-center gap-4 border-t border-gray-100 pt-4 text-xs text-gray-600">
            <Link href="/settings" className="font-semibold text-[#0B6E4F] underline">
              Settings (Download my data)
            </Link>
            <Link href="/delete-account" className="font-semibold text-red-700 underline">
              Delete my account (no login needed)
            </Link>
            <Link href="/terms" className="font-semibold text-[#0B6E4F] underline">
              Terms of Service
            </Link>
            <Link href="/" className="font-semibold text-[#0B6E4F] underline">
              Home
            </Link>
          </div>
        </article>
      </main>
    </div>
  );
}
