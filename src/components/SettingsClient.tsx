"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, PauseCircle, PlayCircle } from "lucide-react";
import type { AccountStatus, UserRole } from "@/lib/constants";
import { AccountDeletionFlow } from "./AccountDeletionFlow";

interface SettingsClientProps {
  role: UserRole;
  initialAccountStatus: AccountStatus;
}

export function SettingsClient({
  role,
  initialAccountStatus,
}: SettingsClientProps) {
  const router = useRouter();
  const [accountStatus, setAccountStatus] =
    useState<AccountStatus>(initialAccountStatus);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pauseMessage, setPauseMessage] = useState<string | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);

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
      {/* Download My Data */}
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

      {/* Artisan Pause Account */}
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

            {accountStatus === "paused" ? (
              <button
                type="button"
                disabled={pauseBusy}
                onClick={() => handleTogglePause(false)}
                className="min-h-11 shrink-0 rounded-xl bg-[#0B6E4F] px-4 py-2 text-xs font-bold text-white hover:bg-[#08523B] disabled:opacity-50"
              >
                {pauseBusy ? "Resuming..." : "Resume my account"}
              </button>
            ) : (
              <button
                type="button"
                disabled={pauseBusy}
                onClick={() => handleTogglePause(true)}
                className="min-h-11 shrink-0 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
              >
                {pauseBusy ? "Pausing..." : "Pause my account"}
              </button>
            )}
          </div>

          {pauseError ? <p className="text-xs text-red-600">{pauseError}</p> : null}
          {pauseMessage ? <p className="text-xs text-[#08523B]">{pauseMessage}</p> : null}
        </section>
      ) : null}

      {/* Delete My Account */}
      <AccountDeletionFlow
        mode="authenticated"
        isArtisan={role === "artisan"}
        onPauseRequested={
          role === "artisan" ? () => handleTogglePause(true) : undefined
        }
      />
    </div>
  );
}
