"use client";

import { useState } from "react";
import { Bell, MapPin, ScanFace, CheckCircle2, XCircle } from "lucide-react";
import type { ConsentRecord, OptionalConsentType, UserRole } from "@/lib/constants";
import { formatLagosDateTime } from "@/lib/time";

interface ConsentsManagerProps {
  role: UserRole;
  initialConsents: ConsentRecord[];
}

interface ConsentItemConfig {
  type: OptionalConsentType;
  title: string;
  description: string;
  icon: typeof MapPin;
  artisanOnly?: boolean;
}

const OPTIONAL_ITEMS: ConsentItemConfig[] = [
  {
    type: "location",
    title: "Location access",
    description:
      "Allows matching with nearby artisans within 10 km (rounded to ~100 m, no history stored). You can withdraw this at any time.",
    icon: MapPin,
  },
  {
    type: "notifications",
    title: "Push & alert notifications",
    description:
      "Receive instant job alerts, quotes, and status updates via web push notifications. You can withdraw this at any time.",
    icon: Bell,
  },
  {
    type: "face_matching",
    title: "Biometric face matching (Artisans only)",
    description:
      "Allows our licensed verification provider to compare your live selfie with your NIN photo to verify your identity. You can withdraw this consent at any time.",
    icon: ScanFace,
    artisanOnly: true,
  },
];

const CONSENT_LABELS: Record<string, string> = {
  age_18_plus: "18+ Age Confirmation",
  terms_of_service: "Terms of Service",
  privacy_policy: "Privacy Policy",
  location: "Location Access",
  notifications: "Notifications",
  face_matching: "Face Matching (Artisan Verification)",
};

export function ConsentsManager({ role, initialConsents }: ConsentsManagerProps) {
  const [consents, setConsents] = useState<ConsentRecord[]>(initialConsents);
  const [busyType, setBusyType] = useState<OptionalConsentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibleOptionalItems = OPTIONAL_ITEMS.filter(
    (item) => !item.artisanOnly || role === "artisan",
  );

  function getActiveConsent(type: OptionalConsentType): ConsentRecord | undefined {
    return consents.find(
      (c) => c.consent_type === type && c.granted && !c.withdrawn_at,
    );
  }

  async function toggleConsent(type: OptionalConsentType, nextGranted: boolean) {
    if (busyType) return;
    setBusyType(type);
    setError(null);

    try {
      const res = await fetch("/api/consents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consentType: type,
          granted: nextGranted,
        }),
      });

      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not update consent.");
        return;
      }

      // Reload canonical consent ledger from server
      const listRes = await fetch("/api/consents");
      if (listRes.ok) {
        const listData = (await listRes.json()) as { consents: ConsentRecord[] };
        setConsents(listData.consents);
      }
    } catch {
      setError("Network error while updating consent. Please try again.");
    } finally {
      setBusyType(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold text-gray-900">
          Optional Permissions &amp; Consents
        </h2>
        <p className="mt-1 text-xs text-gray-600">
          Each optional consent is stored separately with its version and timestamp
          (Africa/Lagos) and can be granted or withdrawn at any time.
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
          >
            {error}
          </div>
        ) : null}

        <div className="mt-4 divide-y divide-gray-100">
          {visibleOptionalItems.map((item) => {
            const Icon = item.icon;
            const active = getActiveConsent(item.type);
            const isBusy = busyType === item.type;

            return (
              <div
                key={item.type}
                className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EBF7F2] text-[#0B6E4F]">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">
                        {item.title}
                      </h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          active
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {active ? "Granted" : "Not granted"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-gray-600">
                      {item.description}
                    </p>
                    {active ? (
                      <p className="mt-1 text-[11px] text-gray-500">
                        Version {active.version} • Granted{" "}
                        {formatLagosDateTime(active.consented_at)}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="shrink-0">
                  {active ? (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => toggleConsent(item.type, false)}
                      className="min-h-10 w-full rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60 sm:w-auto"
                    >
                      {isBusy ? "Updating..." : "Withdraw consent"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => toggleConsent(item.type, true)}
                      className="min-h-10 w-full rounded-lg bg-[#0B6E4F] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#08523B] disabled:opacity-60 sm:w-auto"
                    >
                      {isBusy ? "Saving..." : "Grant consent"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold text-gray-900">Saved Consent History</h2>
        <p className="mt-1 text-xs text-gray-600">
          Stored in UTC and displayed in West Africa Time (Africa/Lagos).
        </p>

        {consents.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">No consent records found yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100 text-xs">
            {consents.map((record) => (
              <li
                key={record.id}
                className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-2">
                  {record.granted && !record.withdrawn_at ? (
                    <CheckCircle2
                      className="h-4 w-4 shrink-0 text-emerald-600"
                      aria-hidden="true"
                    />
                  ) : (
                    <XCircle
                      className="h-4 w-4 shrink-0 text-gray-400"
                      aria-hidden="true"
                    />
                  )}
                  <span className="font-semibold text-gray-900">
                    {CONSENT_LABELS[record.consent_type] ?? record.consent_type}
                  </span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-600">
                    {record.version}
                  </span>
                </div>
                <div className="text-gray-600 sm:text-right">
                  <span>Granted: {formatLagosDateTime(record.consented_at)}</span>
                  {record.withdrawn_at ? (
                    <span className="ml-2 text-red-600">
                      • Withdrawn: {formatLagosDateTime(record.withdrawn_at)}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
