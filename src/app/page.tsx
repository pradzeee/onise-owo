import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Lock,
  MapPin,
  Star,
} from "lucide-react";
import { Header } from "@/components/Header";
import { APP_NAME, TRADES } from "@/lib/constants";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let isAuthenticated = false;
  let roleLabel: string | null = null;

  if (isSupabaseServerConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        isAuthenticated = true;
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();
        roleLabel = profile?.role ?? null;
      }
    } catch {
      // Render public view cleanly if backend not ready
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#F8FAF9]">
      <Header isAuthenticated={isAuthenticated} roleLabel={roleLabel} />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:py-12">
        {/* 1. Hero Section */}
        <section className="relative overflow-hidden rounded-3xl border border-emerald-950/10 bg-gradient-to-br from-[#08523B] via-[#0B6E4F] to-[#043324] p-6 text-white shadow-xl sm:p-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1 text-xs font-semibold text-emerald-100 backdrop-blur-xs">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400" />
            Nigeria&apos;s Trusted Artisan Marketplace
          </div>

          <h1 className="mt-5 text-3xl font-black tracking-tight sm:text-5xl">
            Reliable skilled hands, right in your neighbourhood.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-emerald-100/90 sm:text-base">
            Connect directly with identity-verified plumbers, electricians, tailors, carpenters, mechanics,
            painters, and makeup artists. Protected by Paystack escrow and NDPA 2023 privacy standards.
          </p>

          <div className="mt-8 flex flex-col gap-3.5 sm:flex-row">
            {isAuthenticated ? (
              <>
                <Link
                  href="/dashboard"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-400 px-6 py-3.5 text-base font-bold text-gray-950 shadow-md transition hover:bg-amber-300 active:scale-98"
                >
                  Open Dashboard
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href={roleLabel === "artisan" ? "/jobs" : "/find"}
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/30 bg-white/10 px-6 py-3.5 text-base font-semibold text-white backdrop-blur-xs transition hover:bg-white/20"
                >
                  {roleLabel === "artisan" ? "View Incoming Jobs" : "Find Nearby Artisans"}
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/signup"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-400 px-6 py-3.5 text-base font-bold text-gray-950 shadow-md transition hover:bg-amber-300 active:scale-98"
                >
                  Get started — Register now
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/30 bg-white/10 px-6 py-3.5 text-base font-semibold text-white backdrop-blur-xs transition hover:bg-white/20"
                >
                  Sign in to your account
                </Link>
              </>
            )}
          </div>

          {/* Quick Metrics */}
          <div className="mt-10 grid grid-cols-3 gap-3 border-t border-white/15 pt-6 text-left sm:gap-6">
            <div>
              <p className="text-xl font-black text-amber-400 sm:text-2xl">100%</p>
              <p className="mt-0.5 text-xs text-emerald-100/80">Identity Verified</p>
            </div>
            <div>
              <p className="text-xl font-black text-amber-400 sm:text-2xl">10 km</p>
              <p className="mt-0.5 text-xs text-emerald-100/80">Radius Discovery</p>
            </div>
            <div>
              <p className="text-xl font-black text-amber-400 sm:text-2xl">Escrow</p>
              <p className="mt-0.5 text-xs text-emerald-100/80">Safe Paystack Payouts</p>
            </div>
          </div>
        </section>

        {/* 2. Available Trades Grid */}
        <section className="mt-12">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#0B6E4F]">
                Verified Skills
              </p>
              <h2 className="mt-1 text-2xl font-black text-gray-900 sm:text-3xl">
                Explore Top Trade Categories
              </h2>
            </div>
            <Link
              href={isAuthenticated ? "/find" : "/signup"}
              className="mt-2 text-xs font-bold text-[#0B6E4F] hover:underline sm:mt-0"
            >
              {isAuthenticated ? "Search nearby trades →" : "Register as customer or artisan →"}
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {TRADES.map((trade) => (
              <Link
                key={trade.id}
                href={isAuthenticated ? `/find?trade=${trade.id}` : "/signup"}
                className="group relative flex flex-col justify-between rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs transition hover:-translate-y-0.5 hover:border-[#0B6E4F]/50 hover:shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EBF7F2] text-[#0B6E4F]">
                      <Briefcase className="h-5 w-5" />
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-[#08523B]">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      4.9
                    </span>
                  </div>
                  <h3 className="mt-3 text-base font-bold text-gray-900 group-hover:text-[#0B6E4F]">
                    {trade.label}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">
                    {trade.description}
                  </p>
                </div>
                <div className="mt-4 border-t border-gray-100 pt-3">
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-[#0B6E4F]">
                    {isAuthenticated ? `Find ${trade.label}s →` : "Request an artisan →"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* 3. How It Works */}
        <section className="mt-14 rounded-3xl border border-gray-200/80 bg-white p-6 shadow-sm sm:p-10">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-wider text-[#0B6E4F]">
              Simple &amp; Safe
            </p>
            <h2 className="mt-1 text-2xl font-black text-gray-900 sm:text-3xl">
              How {APP_NAME} Works
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-xs text-gray-500 sm:text-sm">
              We eliminated the risk of unverified handymen and payment disputes.
            </p>
          </div>

          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            <div className="rounded-2xl border border-gray-100 bg-[#F8FAF9] p-5 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EBF7F2] font-black text-[#0B6E4F]">
                1
              </span>
              <h3 className="mt-4 text-sm font-bold text-gray-900">Search or Request</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                Find available artisans within 10 km or post your job request in seconds.
              </p>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-[#F8FAF9] p-5 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EBF7F2] font-black text-[#0B6E4F]">
                2
              </span>
              <h3 className="mt-4 text-sm font-bold text-gray-900">Escrow Funded</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                Agree on price. Your money stays securely in Paystack escrow until the job is done.
              </p>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-[#F8FAF9] p-5 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EBF7F2] font-black text-[#0B6E4F]">
                3
              </span>
              <h3 className="mt-4 text-sm font-bold text-gray-900">OTP Release</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                Inspect the work and provide the 4-digit confirmation OTP to release payment.
              </p>
            </div>
          </div>
        </section>

        {/* 4. Three Pillars of Trust */}
        <section className="mt-12 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs">
            <CheckCircle2 className="h-6 w-6 text-[#0B6E4F]" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-bold text-gray-900">NIN &amp; Selfie Liveness</h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              Every registered artisan undergoes facial liveness matching and guarantor vetting.
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs">
            <MapPin className="h-6 w-6 text-[#0B6E4F]" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-bold text-gray-900">Privacy &amp; NDPA Protected</h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              Exact street addresses are never exposed; location is rounded to ~100m PostGIS points.
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs">
            <Lock className="h-6 w-6 text-[#0B6E4F]" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-bold text-gray-900">No Upfront Payment Loss</h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              Artisans know the money is funded before starting; customers keep full control of completion.
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-gray-200/80 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-xs text-gray-500 sm:px-6">
          <span>&copy; {new Date().getFullYear()} {APP_NAME} Nigeria. All rights reserved.</span>
          <div className="flex flex-wrap items-center gap-5">
            <Link href="/terms" className="hover:text-gray-900">
              Terms of Service
            </Link>
            <Link href="/privacy" className="hover:text-gray-900">
              Privacy Policy
            </Link>
            {isAuthenticated ? (
              <Link href="/dashboard" className="font-semibold text-[#0B6E4F] hover:text-gray-900">
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="hover:text-gray-900">
                  Sign In
                </Link>
                <Link href="/signup" className="font-semibold text-[#0B6E4F] hover:text-gray-900">
                  Register
                </Link>
              </>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
