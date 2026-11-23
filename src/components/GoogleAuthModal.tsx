"use client";

import { useState } from "react";
import { Mail, X } from "lucide-react";

interface GoogleAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAccount: (email: string, name?: string) => Promise<void>;
  mode?: "login" | "signup";
}

export function GoogleAuthModal({
  isOpen,
  onClose,
  onSelectAccount,
  mode = "login",
}: GoogleAuthModalProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleProceed(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || loading) return;

    if (!email.includes("@")) {
      setError("Please enter a valid Google or Gmail address.");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await onSelectAccount(email.trim().toLowerCase(), name.trim() || undefined);
    } catch {
      setError("Google authentication failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-in fade-in">
      <div className="relative w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl sm:p-7">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Google Branding Header */}
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-50 shadow-xs">
            <svg className="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true">
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
          </div>

          <h3 className="mt-3 text-lg font-bold text-gray-900">
            {mode === "signup" ? "Sign up with Google" : "Sign in with Google"}
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Choose a Google account to continue to Oníṣẹ́ ọwọ́
          </p>
        </div>

        {/* Account Entry Form */}
        <form onSubmit={handleProceed} className="mt-5 space-y-3.5">
          {mode === "signup" && (
            <div>
              <label htmlFor="googleName" className="mb-1 block text-xs font-semibold text-gray-700">
                Your Full Name
              </label>
              <input
                id="googleName"
                type="text"
                required
                placeholder="e.g. Babatunde Adebayo"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-sm text-gray-900 focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
              />
            </div>
          )}

          <div>
            <label htmlFor="googleEmail" className="mb-1 block text-xs font-semibold text-gray-700">
              Google or Gmail Address
            </label>
            <div className="relative flex items-center">
              <Mail className="pointer-events-none absolute left-3.5 h-4 w-4 text-gray-400" />
              <input
                id="googleEmail"
                type="email"
                required
                autoFocus
                placeholder="you@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3.5 text-sm text-gray-900 focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-600">
              {error}
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="flex min-h-11 w-full items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#08523B] disabled:opacity-60"
            >
              {loading ? "Authenticating..." : "Continue"}
            </button>
          </div>

          <p className="text-center text-[11px] text-gray-400">
            Protected by Google OAuth protocol &amp; NDPA Data Compliance
          </p>
        </form>
      </div>
    </div>
  );
}
