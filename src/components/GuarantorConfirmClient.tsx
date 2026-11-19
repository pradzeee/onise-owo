"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, ShieldCheck } from "lucide-react";
import { formatLagosDateTime } from "@/lib/time";

interface GuarantorConfirmClientProps {
  token: string;
  guarantorName: string;
  artisanFullName: string;
  artisanTrade: string;
  artisanWorkArea: string;
  maskedPhone: string;
  initialStatus: string;
  initialConfirmedAt: string | null;
}

export function GuarantorConfirmClient({
  token,
  guarantorName,
  artisanFullName,
  artisanTrade,
  artisanWorkArea,
  maskedPhone,
  initialStatus,
  initialConfirmedAt,
}: GuarantorConfirmClientProps) {
  const [status, setStatus] = useState(initialStatus);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(initialConfirmedAt);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [otp, setOtp] = useState("");
  const [devOtpPreview, setDevOtpPreview] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function handleSendOtp() {
    if (busy || !privacyAccepted) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/guarantor/${encodeURIComponent(token)}/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceptedPrivacyNotice: true }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        alreadyConfirmed?: boolean;
        cooldownSeconds?: number;
        retryAfterSeconds?: number;
        devOtpPreview?: string;
      };

      if (!res.ok) {
        setError(data.error ?? "Could not send verification code.");
        if (data.retryAfterSeconds) setCooldown(data.retryAfterSeconds);
        return;
      }

      if (data.alreadyConfirmed) {
        setStatus("confirmed");
        return;
      }

      setOtpRequested(true);
      setCooldown(data.cooldownSeconds ?? 60);
      if (data.devOtpPreview) {
        setDevOtpPreview(data.devOtpPreview);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (busy || otp.length !== 6) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/guarantor/${encodeURIComponent(token)}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: otp,
          acceptedPrivacyNotice: true,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        status?: string;
        confirmedAt?: string;
      };

      if (!res.ok) {
        setError(data.error ?? "Invalid code. Please try again.");
        return;
      }

      setStatus("confirmed");
      setConfirmedAt(data.confirmedAt ?? new Date().toISOString());
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "confirmed") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-sm">
        <CheckCircle2 className="mx-auto h-10 w-10 text-[#0B6E4F]" />
        <h2 className="mt-3 text-xl font-bold text-gray-900">
          Guarantor Confirmation Complete
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Thank you, <strong>{guarantorName}</strong>. You have confirmed{" "}
          <strong>{artisanFullName}</strong> ({artisanTrade.replace("_", " ")} in{" "}
          {artisanWorkArea}) on Oníṣẹ́ ọwọ́.
        </p>
        {confirmedAt ? (
          <p className="mt-3 text-xs text-gray-500">
            Confirmed at {formatLagosDateTime(confirmedAt)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#0B6E4F]">
          Guarantor Confirmation
        </p>
        <h1 className="mt-1 text-xl font-extrabold text-gray-900">
          Hello {guarantorName}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-700">
          <strong>{artisanFullName}</strong> ({artisanTrade.replace("_", " ")} in{" "}
          {artisanWorkArea}) has listed you as their guarantor on{" "}
          <strong>Oníṣẹ́ ọwọ́</strong>.
        </p>
      </div>

      {/* Short Privacy Notice */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs leading-relaxed text-gray-700">
        <div className="flex items-center gap-1.5 font-bold text-gray-900">
          <ShieldCheck className="h-4 w-4 text-[#0B6E4F]" />
          Short Privacy Notice (NDPA 2023)
        </div>
        <p className="mt-1.5">
          We collected your name and mobile number ({maskedPhone}) solely to confirm that
          you know this artisan and vouch for their identity for platform safety. We never
          display your phone number to customers, never use it for marketing, and will
          erase it if the artisan deletes their account or upon your request.
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-3.5 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={privacyAccepted}
          onChange={(e) => setPrivacyAccepted(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-400 text-[#0B6E4F] focus:ring-[#0B6E4F]"
        />
        <span>
          I have read the privacy notice and confirm that I know{" "}
          <strong>{artisanFullName}</strong> personally.
        </span>
      </label>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {devOtpPreview ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950">
          <strong>Local dev mode OTP:</strong>{" "}
          <span className="font-mono text-base font-bold tracking-widest">
            {devOtpPreview}
          </span>
        </div>
      ) : null}

      {!otpRequested ? (
        <button
          type="button"
          disabled={!privacyAccepted || busy || cooldown > 0}
          onClick={handleSendOtp}
          className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#08523B] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy
            ? "Sending one-time code..."
            : `Send 6-digit code to ${maskedPhone}`}
        </button>
      ) : (
        <form onSubmit={handleConfirm} className="space-y-4">
          <div>
            <label htmlFor="guarantor-otp" className="mb-1.5 block text-sm font-semibold text-gray-800">
              Enter the 6-digit SMS code sent to {maskedPhone}
            </label>
            <div className="relative flex items-center">
              <KeyRound className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#0B6E4F]" />
              <input
                id="guarantor-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="min-h-12 w-full rounded-xl border border-gray-300 pl-10 pr-4 text-center text-xl font-bold tracking-[0.35em] focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy || otp.length !== 6 || !privacyAccepted}
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#08523B] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Confirming..." : "Confirm as Guarantor"}
          </button>

          <button
            type="button"
            disabled={busy || cooldown > 0}
            onClick={handleSendOtp}
            className="w-full text-center text-xs font-medium text-gray-600 underline hover:text-gray-900 disabled:no-underline disabled:opacity-50"
          >
            {cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend one-time code"}
          </button>
        </form>
      )}
    </div>
  );
}
