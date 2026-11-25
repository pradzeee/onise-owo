"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, CheckCircle2, Hammer, Search } from "lucide-react";
import { TRADES, type SelectableRole } from "@/lib/constants";

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `onb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function OnboardingForm() {
  const router = useRouter();
  const [role, setRole] = useState<SelectableRole | null>(null);
  const [trade, setTrade] = useState<string>("plumber");
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!role) {
      setError("Please select how you want to use Oníṣẹ́ ọwọ́.");
      return;
    }

    if (!accepted) {
      setError(
        "Please confirm you are 18 or older and accept the Terms of Service and Privacy Policy.",
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKeyRef.current,
        },
        body: JSON.stringify({
          role,
          trade: role === "artisan" ? trade : undefined,
          acceptedAgeAndLegal: true,
          idempotencyKey: idempotencyKeyRef.current,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        nextPath?: string;
      };

      if (!res.ok) {
        setError(data.error ?? "Could not save your account setup.");
        return;
      }

      router.push(data.nextPath ?? "/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please try again — your request is safe to retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-lg shadow-gray-200/40 sm:p-7"
    >
      <div>
        <h2 className="text-base font-bold text-gray-900">
          Choose your account type
        </h2>
        <p className="mt-1 text-xs text-gray-600">
          Select whether you want to hire nearby verified artisans or offer your trade.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setRole("customer")}
            aria-pressed={role === "customer"}
            className={`relative flex flex-col items-start rounded-xl border-2 p-4 text-left transition ${
              role === "customer"
                ? "border-[#0B6E4F] bg-[#EBF7F2]/60 ring-2 ring-[#0B6E4F]/15"
                : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EBF7F2] text-[#0B6E4F]">
                <Search className="h-5 w-5" aria-hidden="true" />
              </span>
              {role === "customer" ? (
                <CheckCircle2 className="h-5 w-5 text-[#0B6E4F]" aria-hidden="true" />
              ) : null}
            </div>
            <span className="mt-3 text-base font-bold text-gray-900">Customer</span>
            <span className="mt-1 text-xs leading-relaxed text-gray-600">
              Find verified plumbers, electricians, tailors, mechanics, and more near you.
            </span>
          </button>

          <button
            type="button"
            onClick={() => setRole("artisan")}
            aria-pressed={role === "artisan"}
            className={`relative flex flex-col items-start rounded-xl border-2 p-4 text-left transition ${
              role === "artisan"
                ? "border-[#0B6E4F] bg-[#EBF7F2]/60 ring-2 ring-[#0B6E4F]/15"
                : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                <Hammer className="h-5 w-5" aria-hidden="true" />
              </span>
              {role === "artisan" ? (
                <CheckCircle2 className="h-5 w-5 text-[#0B6E4F]" aria-hidden="true" />
              ) : null}
            </div>
            <span className="mt-3 text-base font-bold text-gray-900">Artisan</span>
            <span className="mt-1 text-xs leading-relaxed text-gray-600">
              Get verified, receive nearby job requests, send quotes, and get paid via
              Paystack.
            </span>
          </button>
        </div>
      </div>

      {role === "artisan" && (
        <div className="rounded-xl border border-emerald-200 bg-[#EBF7F2]/60 p-4">
          <label
            htmlFor="onboardingTrade"
            className="mb-1.5 block text-xs font-bold text-[#08523B]"
          >
            Select your primary trade
          </label>
          <div className="relative">
            <Briefcase
              className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-[#0B6E4F]"
              aria-hidden="true"
            />
            <select
              id="onboardingTrade"
              name="trade"
              value={trade}
              onChange={(e) => setTrade(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-gray-300 bg-white pl-10 pr-4 text-sm font-semibold text-gray-900 focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
            >
              {TRADES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({t.description})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            required
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-400 text-[#0B6E4F] focus:ring-[#0B6E4F]"
          />
          <span className="text-sm leading-relaxed text-gray-800">
            I am 18 or older and I accept the{" "}
            <Link
              href="/terms"
              target="_blank"
              className="font-semibold text-[#0B6E4F] underline underline-offset-2 hover:text-[#08523B]"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              target="_blank"
              className="font-semibold text-[#0B6E4F] underline underline-offset-2 hover:text-[#08523B]"
            >
              Privacy Policy
            </Link>
            .
          </span>
        </label>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting || !role || !accepted}
        className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-3 text-base font-bold text-white shadow-sm transition hover:bg-[#08523B] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Saving..." : "Continue to Oníṣẹ́ ọwọ́"}
      </button>
    </form>
  );
}
