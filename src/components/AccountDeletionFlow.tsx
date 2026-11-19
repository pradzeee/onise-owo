"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  PauseCircle,
  Phone,
  Trash2,
} from "lucide-react";
import { formatLagosDateTime } from "@/lib/time";
import { TurnstileWidget } from "./TurnstileWidget";

interface AccountDeletionFlowProps {
  mode: "public" | "authenticated";
  isArtisan?: boolean;
  onPauseRequested?: () => Promise<void>;
}

export function AccountDeletionFlow({
  mode,
  isArtisan = false,
  onPauseRequested,
}: AccountDeletionFlowProps) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);

  const [step, setStep] = useState<"review" | "otp" | "done">("review");
  const [maskedPhone, setMaskedPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtpPreview, setDevOtpPreview] = useState<string | null>(null);
  const [scheduledPurgeAt, setScheduledPurgeAt] = useState<string | null>(null);

  const [blockers, setBlockers] = useState<{
    reasons: string[];
    canPause: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCaptchaChange = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBlockers(null);

    if (mode === "public" && !captchaToken) {
      setError("Please complete the human verification check first.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/account/delete/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "public"
            ? { phone, captchaToken }
            : phone.trim()
              ? { phone }
              : {},
        ),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        blocked?: boolean;
        blockers?: { reasons: string[] };
        canPause?: boolean;
        maskedPhone?: string;
        devOtpPreview?: string;
      };

      if (res.status === 409 && data.blocked && data.blockers) {
        setBlockers({
          reasons: data.blockers.reasons,
          canPause: Boolean(data.canPause || isArtisan),
        });
        return;
      }

      if (!res.ok) {
        setError(data.error ?? "Could not send deletion confirmation code.");
        setCaptchaReset((n) => n + 1);
        return;
      }

      setMaskedPhone(data.maskedPhone ?? "");
      if (data.devOtpPreview) setDevOtpPreview(data.devOtpPreview);
      setStep("otp");
    } catch {
      setError("Network error requesting deletion code.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmDeletion(e: React.FormEvent) {
    e.preventDefault();
    if (busy || otp.length !== 6) return;
    setError(null);
    setBlockers(null);
    setBusy(true);

    try {
      const res = await fetch("/api/account/delete/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(mode === "public" ? { phone } : {}),
          code: otp,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        blocked?: boolean;
        blockers?: { reasons: string[] };
        scheduledPurgeAt?: string;
      };

      if (res.status === 409 && data.blocked && data.blockers) {
        setBlockers({
          reasons: data.blockers.reasons,
          canPause: isArtisan,
        });
        setStep("review");
        return;
      }

      if (!res.ok) {
        setError(data.error ?? "Incorrect confirmation code.");
        return;
      }

      setScheduledPurgeAt(data.scheduledPurgeAt ?? null);
      setStep("done");
      if (mode === "authenticated") {
        router.refresh();
      }
    } catch {
      setError("Network error confirming account deletion.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    return (
      <div className="space-y-4 rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-[#0B6E4F]" />
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              Account Marked for Deletion
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-700">
              Your account has been marked <strong>deleted</strong> immediately, hidden
              from all searches, all active sessions have been logged out, and your push
              subscriptions and trusted contacts have been deleted.
            </p>
            <p className="mt-2 text-xs text-gray-600">
              Permanent erasure of personal data, verification files, chat, and job photos
              will complete within 30 days
              {scheduledPurgeAt
                ? ` (scheduled by ${formatLagosDateTime(scheduledPurgeAt)})`
                : ""}
              . You will receive a final SMS confirmation when complete.
            </p>
          </div>
        </div>

        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-xl bg-[#0B6E4F] px-4 py-2 text-xs font-bold text-white hover:bg-[#08523B]"
        >
          Return to home
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-2xl border border-red-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-2.5">
        <Trash2 className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div>
          <h2 className="text-base font-bold text-gray-900">Delete My Account</h2>
          <p className="mt-0.5 text-xs text-gray-600">
            Please review what will be erased and what is retained by law before
            confirming with a 6-digit SMS code.
          </p>
        </div>
      </div>

      {/* Clear disclosure of what is deleted vs kept */}
      <div className="grid gap-3 text-xs sm:grid-cols-2">
        <div className="rounded-xl border border-red-100 bg-red-50/50 p-3.5">
          <p className="font-bold text-red-900">Deleted immediately &amp; within 30 days</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-red-900/90">
            <li>Account hidden from search &amp; all sessions logged out at once</li>
            <li>Push subscriptions &amp; trusted contacts deleted immediately</li>
            <li>
              Within 30 days: profile, selfie &amp; verification files, guarantor details,
              NIN &amp; phone hashes, chat messages, job photos, addresses, and auth user
            </li>
          </ul>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5">
          <p className="font-bold text-gray-900">What is anonymised or kept by law</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-gray-700">
            <li>Reviews you wrote are anonymised (name removed)</li>
            <li>
              Payment accounting records are kept for <strong>6 years</strong> with your
              name replaced by an anonymous ID (no card details)
            </li>
            <li>
              Accounts removed for fraud or violence keep only NIN/phone hashes, reason
              and date in ban records for up to <strong>5 years</strong>
            </li>
            <li>A deletion log with no personal details is kept for audit compliance</li>
          </ul>
        </div>
      </div>

      {/* Exact blocker explanation + Pause offer */}
      {blockers ? (
        <div className="space-y-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-xs text-amber-950">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div>
              <p className="font-bold">Deletion is blocked right now:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {blockers.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <p className="mt-1.5">
                Once these items are completed or resolved, you can delete your account.
              </p>
            </div>
          </div>

          {blockers.canPause && onPauseRequested ? (
            <button
              type="button"
              onClick={onPauseRequested}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-amber-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-amber-800"
            >
              <PauseCircle className="h-4 w-4" />
              Pause my account instead
            </button>
          ) : blockers.canPause ? (
            <Link
              href="/settings"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-amber-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-amber-800"
            >
              <PauseCircle className="h-4 w-4" />
              Go to Settings to pause your account
            </Link>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700"
        >
          {error}
        </div>
      ) : null}

      {step === "review" ? (
        <form onSubmit={handleRequestOtp} className="space-y-4">
          {mode === "public" ? (
            <>
              <div>
                <label
                  htmlFor="del-phone"
                  className="mb-1 block text-sm font-semibold text-gray-800"
                >
                  Nigerian mobile number on your account
                </label>
                <div className="relative flex items-center">
                  <span className="pointer-events-none absolute left-3.5 flex items-center gap-1 text-sm font-semibold text-gray-600">
                    <Phone className="h-4 w-4 text-red-600" />
                    +234
                  </span>
                  <input
                    id="del-phone"
                    type="tel"
                    inputMode="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0803 123 4567"
                    className="min-h-12 w-full rounded-xl border border-gray-300 pl-20 pr-3.5 text-base"
                  />
                </div>
              </div>

              <TurnstileWidget
                onTokenChange={handleCaptchaChange}
                resetSignal={captchaReset}
              />
            </>
          ) : null}

          <button
            type="submit"
            disabled={busy || (mode === "public" && (!phone.trim() || !captchaToken))}
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Checking blockers & sending OTP..." : "Send Deletion Confirmation Code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleConfirmDeletion} className="space-y-4">
          <p className="text-xs text-gray-700">
            Enter the 6-digit SMS confirmation code sent to{" "}
            <strong>{maskedPhone || "your phone"}</strong>.
          </p>

          {devOtpPreview ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
              <strong>Local dev mode OTP:</strong>{" "}
              <span className="font-mono text-base font-bold tracking-widest">
                {devOtpPreview}
              </span>
            </div>
          ) : null}

          <div className="relative flex items-center">
            <KeyRound className="pointer-events-none absolute left-3.5 h-4 w-4 text-red-600" />
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              className="min-h-12 w-full rounded-xl border border-gray-300 pl-10 pr-4 text-center font-mono text-xl font-bold tracking-[0.35em]"
            />
          </div>

          <div className="flex gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setStep("review");
                setOtp("");
                setError(null);
              }}
              className="min-h-12 rounded-xl border border-gray-300 px-4 text-xs font-semibold text-gray-700"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={busy || otp.length !== 6}
              className="min-h-12 flex-1 rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "Deleting account..." : "Confirm Permanent Account Deletion"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
