import Link from "next/link";
import { ArrowRight, CheckCircle2, MapPin, ShieldCheck, Smartphone } from "lucide-react";
import { Header } from "@/components/Header";
import { APP_NAME, TRADES } from "@/lib/constants";

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-12">
        <section className="rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-[#0B6E4F] to-[#08523B] p-6 text-white shadow-sm sm:p-8">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-emerald-50">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Built for Nigeria • Verified local artisans
          </div>

          <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Trusted skilled hands, right in your neighbourhood.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-emerald-50/95 sm:text-base">
            {APP_NAME} connects customers across Nigeria with identity-verified plumbers,
            electricians, tailors, carpenters, mechanics, painters, and makeup artists —
            fast, safe, and lightweight on any phone.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-3 text-base font-bold text-gray-950 transition hover:bg-amber-300"
            >
              Get started — Register now
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              Sign in to your account
            </Link>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-bold text-gray-900">Trades on {APP_NAME}</h2>
          <p className="mt-1 text-xs text-gray-600">
            Every artisan passes identity verification and guarantor confirmation before
            going online.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TRADES.map((trade) => (
              <div
                key={trade.id}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs"
              >
                <h3 className="text-sm font-bold text-gray-900">{trade.label}</h3>
                <p className="mt-1 text-xs text-gray-600">{trade.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <CheckCircle2 className="h-5 w-5 text-[#0B6E4F]" aria-hidden="true" />
            <h3 className="mt-2 text-sm font-bold text-gray-900">Google &amp; Gmail sign-in</h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-600">
              Instant login with your Google account. Link your Nigerian phone in profile anytime.
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <MapPin className="h-5 w-5 text-[#0B6E4F]" aria-hidden="true" />
            <h3 className="mt-2 text-sm font-bold text-gray-900">Privacy-first</h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-600">
              Separate, withdrawable consents for location, notifications, and face
              matching.
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <Smartphone className="h-5 w-5 text-[#0B6E4F]" aria-hidden="true" />
            <h3 className="mt-2 text-sm font-bold text-gray-900">Installable PWA</h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-600">
              Light pages built for small Android phones and slow mobile networks.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-gray-600">
          <span>© {new Date().getFullYear()} {APP_NAME} Nigeria</span>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/terms" className="underline hover:text-gray-900">
              Terms of Service
            </Link>
            <Link href="/privacy" className="underline hover:text-gray-900">
              Privacy Policy
            </Link>
            <Link href="/delete-account" className="underline hover:text-gray-900">
              Delete Account
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
