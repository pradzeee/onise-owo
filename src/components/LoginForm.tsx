"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Eye, EyeOff, Lock, Mail } from "lucide-react";
import {
  createSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { GoogleAuthModal } from "./GoogleAuthModal";

interface LoginFormProps {
  supabaseConfigured: boolean;
}

export function LoginForm({ supabaseConfigured }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [isGoogleModalOpen, setIsGoogleModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    if (googleLoading) return;
    setError(null);

    if (supabaseConfigured && isSupabaseConfigured()) {
      setGoogleLoading(true);
      try {
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
        }
      } catch {
        setError("Google sign-in was interrupted. Please try again.");
        setGoogleLoading(false);
      }
    } else {
      // Open clean Google account modal (Zero window.prompt!)
      setIsGoogleModalOpen(true);
    }
  }

  async function handleGoogleModalSelect(selectedEmail: string) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: selectedEmail, password: "google-oauth-session" }),
    });

    const data = (await res.json()) as { ok?: boolean; error?: string; nextPath?: string };
    if (data.ok) {
      setIsGoogleModalOpen(false);
      router.push(data.nextPath ?? "/dashboard");
      router.refresh();
      return;
    }
    if (data.error) {
      setError(data.error);
      setIsGoogleModalOpen(false);
    }
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        nextPath?: string;
      };

      if (!res.ok || !data.ok) {
        setError(data.error ?? "Invalid email or password.");
        return;
      }

      router.push(data.nextPath ?? "/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please check your internet connection.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-lg shadow-gray-200/40 sm:p-7">
      {/* 1. Log In / Sign Up Segmented Switcher */}
      <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 text-xs font-bold uppercase tracking-wider">
        <div className="flex items-center justify-center rounded-lg bg-white py-2.5 text-[#0B6E4F] shadow-xs">
          Log In
        </div>
        <Link
          href="/signup"
          className="flex items-center justify-center rounded-lg py-2.5 text-gray-500 transition hover:text-gray-900"
        >
          Sign Up
        </Link>
      </div>

      {/* 2. Official Google OAuth Button */}
      <button
        type="button"
        disabled={googleLoading || submitting}
        onClick={handleGoogleSignIn}
        className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-800 shadow-xs transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20 disabled:cursor-not-allowed disabled:opacity-60"
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
        {googleLoading ? "Connecting to Google..." : "Login with Google"}
      </button>

      {/* 3. Divider */}
      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-xs uppercase tracking-wider">
          <span className="bg-white px-3 font-medium text-gray-500">or sign in with password</span>
        </div>
      </div>

      {/* 4. Email & Password Form */}
      <form onSubmit={handlePasswordLogin} className="space-y-4">
        <div>
          <label htmlFor="loginEmail" className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700">
            Email Address
          </label>
          <div className="relative flex items-center">
            <Mail
              className="pointer-events-none absolute left-3.5 h-4 w-4 text-gray-400"
              aria-hidden="true"
            />
            <input
              id="loginEmail"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-gray-300 bg-white pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
            />
          </div>
        </div>

        <div>
          <label htmlFor="loginPassword" className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700">
            Password
          </label>
          <div className="relative flex items-center">
            <Lock
              className="pointer-events-none absolute left-3.5 h-4 w-4 text-gray-400"
              aria-hidden="true"
            />
            <input
              id="loginPassword"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-gray-300 bg-white pl-10 pr-11 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 rounded p-1 text-gray-400 hover:text-gray-600 focus:outline-none"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <p className="font-medium">{error}</p>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting || !email || !password}
          className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#08523B] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Signing in..." : "Log In"}
        </button>

        <p className="pt-2 text-center text-xs text-gray-500">
          Don&apos;t have an account yet?{" "}
          <Link href="/signup" className="font-bold text-[#0B6E4F] hover:underline">
            Register here
          </Link>
        </p>
      </form>

      {/* Google Sign-in Modal (Zero window.prompt!) */}
      <GoogleAuthModal
        isOpen={isGoogleModalOpen}
        onClose={() => setIsGoogleModalOpen(false)}
        onSelectAccount={handleGoogleModalSelect}
        mode="login"
      />
    </div>
  );
}
