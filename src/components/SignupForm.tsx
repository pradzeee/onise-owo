"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, Lock, Mail, User, Wrench } from "lucide-react";
import { TRADES } from "@/lib/constants";
import {
  createSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

interface SignupFormProps {
  supabaseConfigured?: boolean;
}

export function SignupForm({ supabaseConfigured = false }: SignupFormProps) {
  const router = useRouter();
  const [role, setRole] = useState<"customer" | "artisan">("customer");
  const [trade, setTrade] = useState("plumber");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignUp() {
    if (googleLoading) return;
    setError(null);
    setGoogleLoading(true);

    try {
      if (supabaseConfigured && isSupabaseConfigured()) {
        const supabase = createSupabaseBrowserClient();
        const origin = window.location.origin;
        const { error: oauthError } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${origin}/auth/callback`,
          },
        });

        if (oauthError) {
          setError(oauthError.message);
          setGoogleLoading(false);
          return;
        }
      } else {
        // Preview mode: instant Google sign-in
        let targetEmail = email.trim();
        if (!targetEmail) {
          const input = window.prompt("Enter your Gmail address to sign up with Google:");
          if (!input || !input.trim()) {
            setGoogleLoading(false);
            return;
          }
          targetEmail = input.trim();
        }

        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: targetEmail,
            password: "google-oauth-session",
            displayName: displayName.trim() || targetEmail.split("@")[0],
            role,
            trade: role === "artisan" ? trade : undefined,
            acceptedTerms: true,
          }),
        });

        const data = (await res.json()) as { ok?: boolean; error?: string; nextPath?: string };
        if (data.ok) {
          router.push(data.nextPath ?? "/dashboard");
          router.refresh();
          return;
        }
        if (data.error) {
          setError(data.error);
        }
      }
    } catch {
      setError("Google sign-in was interrupted. Please try again.");
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (!acceptedTerms) {
      setError("Please confirm you are 18 or older and accept the terms.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          displayName,
          role,
          trade: role === "artisan" ? trade : undefined,
          acceptedTerms,
        }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string; nextPath?: string };

      if (!res.ok || !data.ok) {
        setError(data.error ?? "Registration failed. Please check your details.");
        return;
      }

      router.push(data.nextPath ?? "/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      {/* 1. Google OAuth Button */}
      <button
        type="button"
        disabled={googleLoading || submitting}
        onClick={handleGoogleSignUp}
        className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-gray-300 bg-white px-4 py-3 text-base font-semibold text-gray-800 shadow-xs transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
          />
        </svg>
        {googleLoading ? "Connecting to Google..." : "Continue with Google"}
      </button>

      {/* 2. Divider */}
      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-3 text-gray-500">or register with email &amp; password</span>
        </div>
      </div>

      {/* 3. Registration Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Category Selection */}
        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-800">
            I want to register as:
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setRole("customer")}
              className={`flex flex-col items-center justify-center rounded-xl border p-3.5 text-center transition ${
                role === "customer"
                  ? "border-[#0B6E4F] bg-[#EBF7F2] text-[#08523B] ring-2 ring-[#0B6E4F]/20"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <User className="mb-1.5 h-5 w-5" />
              <span className="text-sm font-bold">Customer</span>
              <span className="text-[11px] text-gray-500">Hire local artisans</span>
            </button>

            <button
              type="button"
              onClick={() => setRole("artisan")}
              className={`flex flex-col items-center justify-center rounded-xl border p-3.5 text-center transition ${
                role === "artisan"
                  ? "border-[#0B6E4F] bg-[#EBF7F2] text-[#08523B] ring-2 ring-[#0B6E4F]/20"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <Wrench className="mb-1.5 h-5 w-5" />
              <span className="text-sm font-bold">Artisan</span>
              <span className="text-[11px] text-gray-500">Offer my trade skills</span>
            </button>
          </div>
        </div>

        {/* Trade Category Selection for Artisans */}
        {role === "artisan" && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5">
            <label htmlFor="trade" className="mb-1.5 block text-xs font-bold text-gray-800">
              Select Your Trade Category:
            </label>
            <div className="relative">
              <Briefcase
                className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[#0B6E4F]"
                aria-hidden="true"
              />
              <select
                id="trade"
                name="trade"
                value={trade}
                onChange={(e) => setTrade(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-gray-300 bg-white pl-9 pr-4 text-sm font-medium text-gray-900 focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
              >
                {TRADES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} — {t.description}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Display Name */}
        <div>
          <label htmlFor="displayName" className="mb-1 block text-sm font-semibold text-gray-800">
            Full Name
          </label>
          <div className="relative flex items-center">
            <User
              className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#0B6E4F]"
              aria-hidden="true"
            />
            <input
              id="displayName"
              name="displayName"
              type="text"
              required
              placeholder="e.g. Babatunde Adebayo"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-gray-300 bg-white pl-10 pr-4 text-base text-gray-900 placeholder:text-gray-400 focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
            />
          </div>
        </div>

        {/* Email Address */}
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-semibold text-gray-800">
            Email Address
          </label>
          <div className="relative flex items-center">
            <Mail
              className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#0B6E4F]"
              aria-hidden="true"
            />
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="you@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-gray-300 bg-white pl-10 pr-4 text-base text-gray-900 placeholder:text-gray-400 focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-semibold text-gray-800">
            Password
          </label>
          <div className="relative flex items-center">
            <Lock
              className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#0B6E4F]"
              aria-hidden="true"
            />
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-gray-300 bg-white pl-10 pr-4 text-base text-gray-900 placeholder:text-gray-400 focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
            />
          </div>
        </div>

        {/* Terms Checkbox */}
        <label className="flex items-start gap-2.5 pt-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#0B6E4F] focus:ring-[#0B6E4F]"
          />
          <span>
            I confirm I am 18 years or older and accept the{" "}
            <Link href="/terms" className="font-semibold text-[#0B6E4F] underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="font-semibold text-[#0B6E4F] underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#08523B] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Creating Account..." : "Create Account"}
        </button>

        <p className="pt-2 text-center text-xs text-gray-600">
          Already have an account?{" "}
          <Link href="/login" className="font-bold text-[#0B6E4F] underline hover:text-[#08523B]">
            Sign in here
          </Link>
        </p>
      </form>
    </div>
  );
}
