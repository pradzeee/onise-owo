"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, PauseCircle, Phone, PlayCircle } from "lucide-react";
import type { AccountStatus, UserRole } from "@/lib/constants";
import { AccountDeletionFlow } from "./AccountDeletionFlow";

interface SettingsClientProps {
  role: UserRole;
  initialAccountStatus: AccountStatus;
  initialPhone?: string | null;
}

export function SettingsClient({
  role,
  initialAccountStatus,
  initialPhone = null,
}: SettingsClientProps) {
  const router = useRouter();
  const [accountStatus, setAccountStatus] =
    useState<AccountStatus>(initialAccountStatus);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pauseMessage, setPauseMessage] = useState<string | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);

  // Phone number state
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [savedPhone, setSavedPhone] = useState<string | null>(initialPhone);
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneSuccess, setPhoneSuccess] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  async function handleSavePhone(e: React.FormEvent) {
    e.preventDefault();
    if (phoneSaving) return;
    setPhoneSaving(true);
    setPhoneError(null);
    setPhoneSuccess(null);

    try {
      const res = await fetch("/api/account/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        phone?: string;
        maskedPhone?: string;
      };

      if (!res.ok) {
        setPhoneError(data.error ?? "Could not save phone number.");
        return;
      }

      setSavedPhone(data.phone ?? phone);
      setPhoneSuccess(`Phone number saved successfully (${data.maskedPhone ?? phone}).`);
      router.refresh();
    } catch {
      setPhoneError("Network error. Please try again.");
    } finally {
      setPhoneSaving(false);
    }
  }

  async function handleTogglePause(nextPaused: boolean) {
    if (pauseBusy) return;
    setPauseBusy(true);
    setPauseError(null);
    setPauseMessage(null);

    try {
      const res = await fetch("/api/account/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: nextPaused }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        accountStatus?: AccountStatus;
      };
      if (!res.ok) {
        setPauseError(data.error ?? "Could not update account status.");
        return;
      }
      setAccountStatus(data.accountStatus ?? (nextPaused ? "paused" : "active"));
      setPauseMessage(
        nextPaused
          ? "Your artisan account is now paused, set Offline, and hidden from customer searches."
          : "Your artisan account is active again. You can go Online from your dashboard.",
      );
      router.refresh();
    } catch {
      setPauseError("Network error updating account status.");
    } finally {
      setPauseBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* 1. Nigerian Phone Number Management */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-[#0B6E4F]" />
          <h2 className="text-base font-bold text-gray-900">Nigerian Mobile Phone</h2>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-gray-600">
          Add or update your 11-digit Nigerian phone number to receive SMS notifications for job requests,
          quotes, and instant safety alerts.
        </p>

        {savedPhone ? (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-gray-50 px-3.5 py-2.5 text-xs">
            <span className="text-gray-600">Current linked phone:</span>
            <span className="font-mono font-bold text-gray-900">{savedPhone}</span>
          </div>
        ) : null}

        {phoneSuccess ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-[#EBF7F2] p-3 text-xs text-[#08523B]">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <p>{phoneSuccess}</p>
          </div>
        ) : null}

        {phoneError ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {phoneError}
          </div>
        ) : null}

        <form onSubmit={handleSavePhone} className="mt-4 space-y-3">
          <div>
            <label htmlFor="phoneInput" className="mb-1 block text-xs font-semibold text-gray-700">
              {savedPhone ? "Change Mobile Number" : "Enter Mobile Number"}
            </label>
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute left-3 flex items-center gap-1 text-xs font-semibold text-gray-600">
                🇳🇬 +234
              </span>
              <input
                id="phoneInput"
                type="tel"
                inputMode="tel"
                placeholder="0803 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="min-h-11 w-full rounded-xl border border-gray-300 bg-white pl-20 pr-3 text-sm text-gray-900 focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
              />
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              Standard Nigerian networks supported (MTN, Airtel, Glo, 9mobile).
            </p>
          </div>

          <button
            type="submit"
            disabled={phoneSaving || !phone}
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#08523B] disabled:opacity-60"
          >
            {phoneSaving ? "Saving..." : savedPhone ? "Update Phone Number" : "Save Phone Number"}
          </button>
        </form>
      </section>

      {/* 2. Download My Data */}
      <section className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
            <Download className="h-4 w-4 text-[#0B6E4F]" />
            Download My Data
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            Download a JSON copy of your profile, consents, jobs, quotes, messages sent,
            payments (no card details), and reviews under Nigeria&apos;s NDPA 2023.
          </p>
        </div>
        <a
          href="/api/account/export"
          download
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#0B6E4F] px-4 py-2 text-xs font-bold text-white hover:bg-[#08523B]"
        >
          <Download className="h-4 w-4" />
          Download JSON
        </a>
      </section>

      {/* 3. Artisan Pause Account */}
      {role === "artisan" ? (
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
                {accountStatus === "paused" ? (
                  <PlayCircle className="h-4 w-4 text-amber-600" />
                ) : (
                  <PauseCircle className="h-4 w-4 text-[#0B6E4F]" />
                )}
                Pause My Artisan Account
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">
                Need a break? Pausing immediately sets you Offline and hides you from
                search without losing your verification or reviews.
              </p>
            </div>
            <button
              type="button"
              disabled={pauseBusy}
              onClick={() => handleTogglePause(accountStatus !== "paused")}
              className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition disabled:opacity-60 ${
                accountStatus === "paused"
                  ? "bg-[#0B6E4F] text-white hover:bg-[#08523B]"
                  : "border border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100"
              }`}
            >
              {accountStatus === "paused" ? (
                <>
                  <PlayCircle className="h-4 w-4" />
                  Resume Account
                </>
              ) : (
                <>
                  <PauseCircle className="h-4 w-4" />
                  Pause Account
                </>
              )}
            </button>
          </div>

          {pauseMessage ? (
            <p className="text-xs font-medium text-[#08523B]">{pauseMessage}</p>
          ) : null}
          {pauseError ? (
            <p className="text-xs font-medium text-red-700">{pauseError}</p>
          ) : null}
        </section>
      ) : null}

      {/* 4. Delete My Account */}
      <section className="space-y-3 rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold text-red-700">Delete My Account</h2>
        <p className="text-xs leading-relaxed text-gray-600">
          Under Nigeria&apos;s NDPA 2023, you have the right to erase your account and personal data.
          Deletion is permanent after a 30-day grace period. Accounts with open jobs, active disputes,
          or pending payouts cannot be deleted until resolved.
        </p>

        <AccountDeletionFlow mode="authenticated" isArtisan={role === "artisan"} />
      </section>
    </div>
  );
}
