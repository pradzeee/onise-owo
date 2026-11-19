"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, Phone, ShieldCheck } from "lucide-react";
import { TurnstileWidget } from "./TurnstileWidget";

interface LoginFormProps {
  supabaseConfigured: boolean;
}

export function LoginForm({ supabaseConfigured }: LoginFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [maskedPhone, setMaskedPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleTokenChange = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    setError(null);
    setInfo(null);

    if (!captchaToken) {
      setError("Please complete the human verification check first.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, captchaToken }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        maskedPhone?: string;
        cooldownSeconds?: number;
        retryAfterSeconds?: number;
      };

      if (!res.ok) {
        setError(data.error ?? "Could not send verification code.");
        if (data.retryAfterSeconds) {
          setCooldown(data.retryAfterSeconds);
        }
        setCaptchaResetSignal((n) => n + 1);
        return;
      }

      setMaskedPhone(data.maskedPhone ?? "");
      setCooldown(data.cooldownSeconds ?? 60);
      setStep("otp");
      setInfo("We sent a 6-digit SMS code to your phone.");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: otp }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        nextPath?: string;
      };

      if (!res.ok) {
        setError(data.error ?? "Invalid verification code.");
        return;
      }

      router.push(data.nextPath ?? "/onboarding");
      router.refresh();
    } catch {
      setError("Network error while verifying code. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDevLogin(role: "admin" | "artisan" | "customer", redirectUrl: string) {
    try {
      const res = await fetch("/api/dev/switch-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, redirectUrl }),
      });
      const data = (await res.json()) as { ok?: boolean; redirectUrl?: string };
      if (data.ok) {
        router.push(data.redirectUrl ?? redirectUrl);
        router.refresh();
      }
    } catch (err) {
      console.error("Dev login error:", err);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      {!supabaseConfigured ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
          <strong>Setup notice:</strong> Copy{" "}
          <code className="font-mono">.env.example</code> to{" "}
          <code className="font-mono">.env.local</code> and add your Supabase credentials
          to enable live SMS OTP sign-in.
        </div>
      ) : null}

      {step === "phone" ? (
        <form onSubmit={handleRequestOtp} className="space-y-4">
          <div>
            <label
              htmlFor="phone"
              className="mb-1.5 block text-sm font-semibold text-gray-800"
            >
              Nigerian mobile number
            </label>
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute left-3.5 flex items-center gap-1.5 text-sm font-semibold text-gray-600">
                <Phone className="h-4 w-4 text-[#0B6E4F]" aria-hidden="true" />
                +234
              </span>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                required
                placeholder="0803 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="min-h-12 w-full rounded-xl border border-gray-300 bg-white pl-20 pr-4 text-base text-gray-900 placeholder:text-gray-400 focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
              />
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              We&apos;ll send a 6-digit one-time code by SMS. Standard Nigerian numbers
              (070, 080, 081, 090, 091) are supported.
            </p>
          </div>

          <TurnstileWidget
            onTokenChange={handleTokenChange}
            resetSignal={captchaResetSignal}
          />

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
            disabled={submitting || !captchaToken || cooldown > 0}
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#08523B] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting
              ? "Sending SMS code..."
              : cooldown > 0
                ? `Wait ${cooldown}s to resend`
                : "Send verification code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setOtp("");
              setError(null);
              setCaptchaResetSignal((n) => n + 1);
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Change phone number
          </button>

          {info ? (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-[#EBF7F2] p-3 text-xs text-[#08523B]">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                {info} {maskedPhone ? <span className="font-semibold">({maskedPhone})</span> : null}
              </p>
            </div>
          ) : null}

          <div>
            <label
              htmlFor="otp"
              className="mb-1.5 block text-sm font-semibold text-gray-800"
            >
              6-digit verification code
            </label>
            <div className="relative flex items-center">
              <KeyRound
                className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#0B6E4F]"
                aria-hidden="true"
              />
              <input
                id="otp"
                name="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="\d{6}"
                required
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="min-h-12 w-full rounded-xl border border-gray-300 bg-white pl-10 pr-4 text-center text-xl font-bold tracking-[0.35em] text-gray-900 placeholder:tracking-normal placeholder:font-normal placeholder:text-gray-400 focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
              />
            </div>
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
            disabled={submitting || otp.length !== 6}
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#08523B] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Verifying..." : "Verify & continue"}
          </button>

          <p className="text-center text-xs text-gray-500">
            {cooldown > 0
              ? `You can request a new code in ${cooldown}s.`
              : "Didn't receive it? Go back to request a new code."}
          </p>
        </form>
      )}

      {/* Local Development Full Access Switcher */}
      <div className="mt-6 border-t border-dashed border-gray-200 pt-5">
        <p className="mb-2.5 text-center text-xs font-bold uppercase tracking-wider text-amber-800">
          ⚡ 1-Click Dev Testing Logins (Full Access)
        </p>
        <div className="grid gap-2">
          <button
            type="button"
            onClick={() => handleDevLogin("admin", "/admin")}
            className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-xs font-semibold text-gray-900 transition hover:border-[#0B6E4F] hover:bg-[#EBF7F2]"
          >
            <span className="flex items-center gap-1.5">
              <span>👑</span>
              <span><strong>Admin</strong> (Superuser Dashboard &amp; MFA)</span>
            </span>
            <span className="font-bold text-[#0B6E4F]">Launch →</span>
          </button>
          <button
            type="button"
            onClick={() => handleDevLogin("artisan", "/dashboard")}
            className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-xs font-semibold text-gray-900 transition hover:border-[#0B6E4F] hover:bg-[#EBF7F2]"
          >
            <span className="flex items-center gap-1.5">
              <span>🔧</span>
              <span><strong>Artisan</strong> (Kazeem - Electrician)</span>
            </span>
            <span className="font-bold text-[#0B6E4F]">Launch →</span>
          </button>
          <button
            type="button"
            onClick={() => handleDevLogin("customer", "/find")}
            className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-xs font-semibold text-gray-900 transition hover:border-[#0B6E4F] hover:bg-[#EBF7F2]"
          >
            <span className="flex items-center gap-1.5">
              <span>👤</span>
              <span><strong>Customer</strong> (Chioma - Lagos Map &amp; Jobs)</span>
            </span>
            <span className="font-bold text-[#0B6E4F]">Launch →</span>
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-gray-400">
          Dev helper active in development mode. Cleanly erased before production hosting.
        </p>
      </div>
    </div>
  );
}
