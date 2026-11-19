"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Radio, ShieldAlert, Sun } from "lucide-react";
import type { VerificationStatus } from "@/lib/constants";
import {
  HEARTBEAT_INTERVAL_MS,
  OFFLINE_TIMEOUT_MINUTES,
  roundCoordTo100m,
} from "@/lib/location";
import { formatLagosDateTime } from "@/lib/time";

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
}

interface ArtisanOnlineSwitchProps {
  verificationStatus: VerificationStatus;
  initialIsOnline: boolean;
  initialLastSeenAt: string | null;
  initialHasLocationConsent: boolean;
}

export function ArtisanOnlineSwitch({
  verificationStatus,
  initialIsOnline,
  initialLastSeenAt,
  initialHasLocationConsent,
}: ArtisanOnlineSwitchProps) {
  const isApproved = verificationStatus === "approved";

  const [isOnline, setIsOnline] = useState(isApproved && initialIsOnline);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(initialLastSeenAt);
  const [approxCoords, setApproxCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [hasLocationConsent, setHasLocationConsent] = useState(initialHasLocationConsent);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [wakeLockSupported, setWakeLockSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch {
        // Ignore release errors
      }
      wakeLockRef.current = null;
    }
    setWakeLockActive(false);
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      setWakeLockSupported(false);
      setWakeLockActive(false);
      return;
    }
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
      };
      const sentinel = await nav.wakeLock?.request("screen");
      if (sentinel) {
        wakeLockRef.current = sentinel;
        setWakeLockActive(true);
        sentinel.addEventListener?.("release", () => {
          setWakeLockActive(false);
        });
      }
    } catch {
      setWakeLockActive(false);
    }
  }, []);

  const requestBrowserCoords = useCallback((): Promise<{ lat: number; lng: number }> => {
    return new Promise((resolve, reject) => {
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
        reject(new Error("Your browser does not support GPS location."));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: roundCoordTo100m(pos.coords.latitude),
            lng: roundCoordTo100m(pos.coords.longitude),
          });
        },
        (geoErr) => {
          if (geoErr.code === geoErr.PERMISSION_DENIED) {
            reject(
              new Error(
                "Browser location permission was denied. Please allow location access in your browser settings to go Online.",
              ),
            );
          } else {
            reject(
              new Error(
                "Could not read your GPS position. Move to an open area and try again.",
              ),
            );
          }
        },
        {
          enableHighAccuracy: false, // Battery-friendly; we only need ~100m accuracy
          timeout: 12_000,
          maximumAge: 30_000,
        },
      );
    });
  }, []);

  const sendHeartbeat = useCallback(async () => {
    try {
      let coords: { lat: number; lng: number } | undefined;
      try {
        coords = await requestBrowserCoords();
      } catch {
        // If one GPS read momentarily fails, server reuses last ~100m point
      }

      const res = await fetch("/api/artisan/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isOnline: true,
          ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        presence?: {
          is_online: boolean;
          last_seen_at: string;
          approx_lat: number | null;
          approx_lng: number | null;
        };
      };

      if (!res.ok) {
        setError(data.error ?? "Heartbeat failed.");
        setIsOnline(false);
        await releaseWakeLock();
        return;
      }

      if (data.presence) {
        setLastSeenAt(data.presence.last_seen_at);
        if (
          data.presence.approx_lat !== null &&
          data.presence.approx_lng !== null
        ) {
          setApproxCoords({
            lat: data.presence.approx_lat,
            lng: data.presence.approx_lng,
          });
        }
      }
    } catch {
      // Keep trying on next 60s interval
    }
  }, [requestBrowserCoords, releaseWakeLock]);

  // Manage 60-second heartbeat + Wake Lock while Online
  useEffect(() => {
    if (!isOnline) {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      releaseWakeLock();
      return;
    }

    acquireWakeLock();
    heartbeatTimerRef.current = setInterval(() => {
      sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        acquireWakeLock();
        sendHeartbeat();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      document.removeEventListener("visibilitychange", handleVisibility);
      releaseWakeLock();
    };
  }, [isOnline, acquireWakeLock, releaseWakeLock, sendHeartbeat]);

  async function handleToggleOnline() {
    if (busy || !isApproved) return;
    setBusy(true);
    setError(null);

    try {
      if (isOnline) {
        const res = await fetch("/api/artisan/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isOnline: false }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          setError(data.error ?? "Could not switch Offline.");
          return;
        }
        setIsOnline(false);
        await releaseWakeLock();
        return;
      }

      // 1. Ensure withdrawable 'location' consent is granted before reading GPS
      if (!hasLocationConsent) {
        const consentRes = await fetch("/api/consents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ consentType: "location", granted: true }),
        });
        if (!consentRes.ok) {
          setError("Could not record your location consent. Please try again.");
          return;
        }
        setHasLocationConsent(true);
      }

      // 2. Ask browser geolocation permission & round to ~100m
      const coords = await requestBrowserCoords();

      // 3. Go Online on server
      const res = await fetch("/api/artisan/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isOnline: true,
          lat: coords.lat,
          lng: coords.lng,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        presence?: {
          is_online: boolean;
          last_seen_at: string;
          approx_lat: number | null;
          approx_lng: number | null;
        };
      };

      if (!res.ok) {
        setError(data.error ?? "Could not go Online.");
        return;
      }

      setIsOnline(true);
      if (data.presence) {
        setLastSeenAt(data.presence.last_seen_at);
        if (
          data.presence.approx_lat !== null &&
          data.presence.approx_lng !== null
        ) {
          setApproxCoords({
            lat: data.presence.approx_lat,
            lng: data.presence.approx_lng,
          });
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not go Online right now. Please check GPS permission.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Radio
              className={`h-4 w-4 ${isOnline ? "text-emerald-600 animate-pulse" : "text-gray-400"}`}
            />
            <h2 className="text-base font-bold text-gray-900">Availability Status</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                isOnline
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {isOnline ? "Online" : "Offline"}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            Online means the app is open. While Online, we send your approximate location
            (rounded to ~100 m, no history) every 60 seconds and keep your screen awake.
            You are automatically set Offline after {OFFLINE_TIMEOUT_MINUTES} minutes
            without a signal.
          </p>
        </div>

        <button
          type="button"
          disabled={!isApproved || busy}
          onClick={handleToggleOnline}
          className={`min-h-12 shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            isOnline
              ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              : "bg-[#0B6E4F] text-white hover:bg-[#08523B]"
          }`}
        >
          {busy
            ? "Updating..."
            : isOnline
              ? "Go Offline"
              : "Go Online"}
        </button>
      </div>

      {!isApproved ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Only <strong>approved</strong> artisans can go Online. Your current
            verification status is <strong className="capitalize">{verificationStatus}</strong>.
          </p>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700"
        >
          {error}
        </div>
      ) : null}

      {isApproved ? (
        <div className="mt-4 grid gap-2.5 border-t border-gray-100 pt-3.5 text-xs sm:grid-cols-3">
          <div className="rounded-xl bg-gray-50 p-3">
            <span className="flex items-center gap-1 text-gray-500">
              <MapPin className="h-3.5 w-3.5" />
              Approx. point (~100m)
            </span>
            <p className="mt-1 font-mono font-semibold text-gray-900">
              {approxCoords
                ? `${approxCoords.lat.toFixed(3)}, ${approxCoords.lng.toFixed(3)}`
                : "Not active"}
            </p>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <span className="text-gray-500">Last signal (Lagos)</span>
            <p className="mt-1 font-semibold text-gray-900">
              {formatLagosDateTime(lastSeenAt)}
            </p>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <span className="flex items-center gap-1 text-gray-500">
              <Sun className="h-3.5 w-3.5" />
              Screen Wake Lock
            </span>
            <p className="mt-1 font-semibold text-gray-900">
              {!isOnline
                ? "Inactive"
                : wakeLockActive
                  ? "Screen kept awake"
                  : wakeLockSupported
                    ? "Waiting for focus"
                    : "Not supported on browser"}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
