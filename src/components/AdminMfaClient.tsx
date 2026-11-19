"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";

interface AdminMfaClientProps {
  nextPath: string;
}

export function AdminMfaClient({ nextPath }: AdminMfaClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [enrolled, setEnrolled] = useState(false);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [otpAuthUri, setOtpAuthUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/mfa/status", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.mfaVerified) {
          router.replace(nextPath);
          return;
        }
        setEnrolled(Boolean(data.enrolled));
        setSetupSecret(data.setupSecretBase32 ?? null);
        setOtpAuthUri(data.otpAuthUri ?? null);
      })
      .catch(() => setError("Could not initialize admin two-step verification."))
      .finally(() => setLoading(false));
  }, [nextPath, router]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || code.length !== 6) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Invalid 6-digit authenticator code.");
        return;
      }

      router.replace(nextPath);
      router.refresh();
    } catch {
      setError("Network error verifying code.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
        Checking admin two-step verification...
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-[#0B6E4F]" />
        <div>
          <h1 className="text-lg font-extrabold text-gray-900">
            Admin Two-Step Verification
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            {enrolled
              ? "Enter the current 6-digit code from your authenticator app to unlock the admin dashboard for 4 hours."
              : "First-time setup: add the secret key below into Google Authenticator, Authy, or 1Password, then enter the 6-digit code it generates."}
          </p>
        </div>
      </div>

      {!enrolled && setupSecret ? (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
          <p className="font-bold">Authenticator Setup Key (Base32):</p>
          <p className="rounded-lg bg-white px-3 py-2 font-mono text-sm font-bold tracking-wider text-gray-900 break-all">
            {setupSecret}
          </p>
          {otpAuthUri ? (
            <details className="pt-1">
              <summary className="cursor-pointer font-semibold underline">
                Show otpauth:// URI
              </summary>
              <p className="mt-1 break-all font-mono text-[11px]">{otpAuthUri}</p>
            </details>
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

      <form onSubmit={handleVerify} className="space-y-4">
        <div className="relative flex items-center">
          <KeyRound className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#0B6E4F]" />
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="min-h-12 w-full rounded-xl border border-gray-300 pl-10 pr-4 text-center font-mono text-xl font-bold tracking-[0.35em]"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || code.length !== 6}
          className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-3 text-sm font-bold text-white hover:bg-[#08523B] disabled:opacity-60"
        >
          {submitting ? "Verifying..." : "Verify & Unlock Admin Dashboard"}
        </button>
      </form>
    </div>
  );
}
