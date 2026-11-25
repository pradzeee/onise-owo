import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { APP_NAME, LEGAL_VERSIONS } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Terms of Service",
};

export default function TermsPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-[#F8FAF9]">
      <Header />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <article className="space-y-6 rounded-2xl border border-gray-200/80 bg-white p-6 shadow-sm sm:p-8">
          <div className="border-b border-gray-100 pb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#0B6E4F]">
              Legal • Version {LEGAL_VERSIONS.terms_of_service}
            </p>
            <h1 className="mt-1 text-2xl font-extrabold text-gray-900">
              {APP_NAME} Terms of Service
            </h1>
            <p className="mt-1 text-xs text-gray-500">
              Effective for users in the Federal Republic of Nigeria
            </p>
          </div>

          <section className="space-y-2 text-sm leading-relaxed text-gray-700">
            <h2 className="text-base font-bold text-gray-900">1. Eligibility (18+ Only)</h2>
            <p>
              You must be at least 18 years old and legally able to enter a binding
              contract in Nigeria to create an account on {APP_NAME}. By creating an
              account, you confirm that all information you provide is accurate.
            </p>
          </section>

          <section className="space-y-2 text-sm leading-relaxed text-gray-700">
            <h2 className="text-base font-bold text-gray-900">2. Accounts &amp; Roles</h2>
            <p>
              Users may register as a Customer or an Artisan. Administrative access is
              never self-assigned. Artisans must complete identity verification (via our
              licensed Nigerian verification provider) and guarantor confirmation before
              they can go online and accept jobs.
            </p>
          </section>

          <section className="space-y-2 text-sm leading-relaxed text-gray-700">
            <h2 className="text-base font-bold text-gray-900">
              3. Quotes, Payments &amp; Cancellations
            </h2>
            <p>
              All prices are quoted in Nigerian Naira (stored internally as whole kobo).
              Payments are processed securely through Paystack with a 15% platform
              commission. Cancellations made after an artisan is en route may incur a
              cancellation fee as displayed before confirmation.
            </p>
          </section>

          <section className="space-y-2 text-sm leading-relaxed text-gray-700">
            <h2 className="text-base font-bold text-gray-900">
              4. Safety, Conduct &amp; Suspensions
            </h2>
            <p>
              Fraud, harassment, violence, or off-platform abuse of personal data is
              strictly prohibited. Urgent safety suspensions apply immediately and are
              reviewed by a human administrator within 2 business days.
            </p>
          </section>

          <section className="space-y-2 text-sm leading-relaxed text-gray-700">
            <h2 className="text-base font-bold text-gray-900">5. Governing Law</h2>
            <p>
              These Terms are governed by the laws of the Federal Republic of Nigeria.
            </p>
          </section>

          <div className="border-t border-gray-100 pt-4 text-xs text-gray-600">
            See also our{" "}
            <Link href="/privacy" className="font-semibold text-[#0B6E4F] underline">
              Privacy Policy
            </Link>{" "}
            or return to{" "}
            <Link href="/" className="font-semibold text-[#0B6E4F] underline">
              Home
            </Link>
            .
          </div>
        </article>
      </main>
    </div>
  );
}
