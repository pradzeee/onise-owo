"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, CheckCircle2, Send } from "lucide-react";
import type { AlertDeliveryRecord } from "@/lib/constants";
import { formatLagosDateTime } from "@/lib/time";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export function PushNotificationsCard() {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertDeliveryRecord[]>([]);

  const refreshAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts/test");
      if (res.ok) {
        const data = (await res.json()) as { alerts: AlertDeliveryRecord[] };
        setAlerts(data.alerts ?? []);
      }
    } catch {
      // Ignore transient refresh errors
    }
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setSupported(false);
      return;
    }

    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => {});

    refreshAlerts();
  }, [refreshAlerts]);

  async function handleEnablePush() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      if (!vapidPublicKey) {
        setError(
          "Web Push VAPID keys are not configured yet (set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env.local). Alerts will still fall back to SMS after 30 seconds.",
        );
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError(
          "Browser notification permission was not granted. You will receive backup SMS alerts instead.",
        );
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));

      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: {
            p256dh: json.keys?.p256dh,
            auth: json.keys?.auth,
          },
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Could not register push subscription.");
        return;
      }

      setSubscribed(true);
      setInfo("Web Push alerts enabled! New requests will alert you immediately.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not enable push notifications.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDisablePush() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const endpoint = sub?.endpoint;
      if (sub) {
        await sub.unsubscribe();
      }
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      setSubscribed(false);
      setInfo("Web Push disabled on this device.");
    } catch {
      setError("Could not disable Web Push.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendTestAlert() {
    if (testing) return;
    setTesting(true);
    setError(null);
    setInfo(null);

    try {
      const res = await fetch("/api/alerts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: `test-ui-${Date.now()}`,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        delivery?: { status: string; pushSentCount: number };
      };

      if (!res.ok) {
        setError(data.error ?? "Could not send test alert.");
        return;
      }

      setInfo(
        data.delivery?.pushSentCount
          ? "Web Push sent! If not acknowledged within 30 seconds, a backup SMS will be sent automatically."
          : "No active push subscription detected — backup SMS will trigger automatically after 30 seconds.",
      );
      await refreshAlerts();
      // Poll again after 32s to show SMS backup completion if push wasn't acked
      setTimeout(() => {
        refreshAlerts();
      }, 32_000);
    } catch {
      setError("Network error while sending test alert.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-[#0B6E4F]" />
            <h2 className="text-base font-bold text-gray-900">
              Job Alerts (Web Push + 30s SMS Backup)
            </h2>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            Receive instant Web Push notifications for new job requests. If a push alert
            isn&apos;t delivered within 30 seconds, we automatically send a backup SMS.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {supported ? (
            subscribed ? (
              <button
                type="button"
                disabled={busy}
                onClick={handleDisablePush}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <BellOff className="h-3.5 w-3.5" />
                {busy ? "Updating..." : "Disable Push"}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={handleEnablePush}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#0B6E4F] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#08523B] disabled:opacity-50"
              >
                <Bell className="h-3.5 w-3.5" />
                {busy ? "Enabling..." : "Enable Web Push"}
              </button>
            )
          ) : (
            <span className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600">
              Push not supported — SMS backup active
            </span>
          )}

          <button
            type="button"
            disabled={testing}
            onClick={handleSendTestAlert}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-emerald-200 bg-[#EBF7F2] px-3 py-2 text-xs font-semibold text-[#08523B] hover:bg-emerald-100 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            {testing ? "Sending..." : "Test alert"}
          </button>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700"
        >
          {error}
        </div>
      ) : null}

      {info ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-[#EBF7F2] px-3.5 py-2.5 text-xs text-[#08523B]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{info}</span>
        </div>
      ) : null}

      {alerts.length > 0 ? (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-700">Recent Alert Deliveries</p>
            <button
              type="button"
              onClick={refreshAlerts}
              className="text-[11px] font-medium text-[#0B6E4F] underline"
            >
              Refresh status
            </button>
          </div>
          <ul className="mt-2 divide-y divide-gray-100 text-xs">
            {alerts.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="capitalize text-gray-800">
                  {a.alert_type.replace("_", " ")} •{" "}
                  <strong className="font-mono text-[11px]">{a.status}</strong>
                </span>
                <span className="text-gray-500">{formatLagosDateTime(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
