"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, MapPin, Navigation, ShieldCheck, Users } from "lucide-react";
import { TRADES, type ArtisanTrade, type DispatchMode } from "@/lib/constants";
const MAX_JOB_PHOTOS = 3;
import {
  DEFAULT_NIGERIA_CENTER,
  NIGERIA_CITY_PRESETS,
  roundCoordTo100m,
} from "@/lib/location";

interface CreateJobFormProps {
  initialTrade?: ArtisanTrade;
  initialLat?: number;
  initialLng?: number;
  initialArea?: string;
  targetArtisanId?: string;
  targetArtisanName?: string;
}

function createIdemKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function CreateJobForm({
  initialTrade = "plumber",
  initialLat,
  initialLng,
  initialArea = "",
  targetArtisanId,
  targetArtisanName,
}: CreateJobFormProps) {
  const router = useRouter();
  const [trade, setTrade] = useState<ArtisanTrade>(initialTrade);
  const [dispatchMode, setDispatchMode] = useState<DispatchMode>(
    targetArtisanId ? "direct" : "nearest_3",
  );
  const [description, setDescription] = useState("");
  const [approxAreaLabel, setApproxAreaLabel] = useState(initialArea);
  const [exactAddress, setExactAddress] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number }>({
    lat: initialLat ?? DEFAULT_NIGERIA_CENTER.lat,
    lng: initialLng ?? DEFAULT_NIGERIA_CENTER.lng,
  });
  const [photos, setPhotos] = useState<File[]>([]);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idemKeyRef = useRef<string>(createIdemKey());

  async function handleUseGpsPin() {
    if (locating) return;
    setLocating(true);
    setError(null);
    try {
      if (!("geolocation" in navigator)) {
        setError("GPS not supported in this browser. Pick an area preset below.");
        return;
      }
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12_000,
        });
      });
      setCoords({
        lat: Number(pos.coords.latitude.toFixed(6)),
        lng: Number(pos.coords.longitude.toFixed(6)),
      });
    } catch {
      setError("Could not read GPS pin. Select a Nigerian area preset instead.");
    } finally {
      setLocating(false);
    }
  }

  function handlePhotosChange(fileList: FileList | null) {
    if (!fileList) return;
    const selected = Array.from(fileList).slice(0, MAX_JOB_PHOTOS);
    setPhotos(selected);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (description.trim().length < 10) {
      setError("Please describe the job in at least 10 characters.");
      return;
    }
    if (approxAreaLabel.trim().length < 2) {
      setError("Enter your general neighbourhood/area (e.g. Ikeja, Lagos).");
      return;
    }
    if (exactAddress.trim().length < 5) {
      setError("Enter your exact address (revealed only after an artisan accepts).");
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("trade", trade);
      fd.set("dispatchMode", dispatchMode);
      if (dispatchMode === "direct" && targetArtisanId) {
        fd.set("targetArtisanId", targetArtisanId);
      }
      fd.set("description", description.trim());
      fd.set("approxAreaLabel", approxAreaLabel.trim());
      fd.set("exactAddress", exactAddress.trim());
      fd.set("lat", String(coords.lat));
      fd.set("lng", String(coords.lng));
      fd.set("idempotencyKey", idemKeyRef.current);

      for (const file of photos.slice(0, MAX_JOB_PHOTOS)) {
        fd.append("photos", file);
      }

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "X-Idempotency-Key": idemKeyRef.current },
        body: fd,
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        jobId?: string;
      };

      if (!res.ok || !data.jobId) {
        setError(data.error ?? "Could not send job request.");
        idemKeyRef.current = createIdemKey();
        return;
      }

      router.push(`/jobs/${data.jobId}`);
      router.refresh();
    } catch {
      setError("Network error while sending request. Safe to retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
    >
      {/* Dispatch mode */}
      <div className="space-y-2.5">
        <label className="block text-sm font-bold text-gray-900">
          How should we send this request?
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setDispatchMode("nearest_3")}
            className={`rounded-xl border-2 p-3.5 text-left transition ${
              dispatchMode === "nearest_3"
                ? "border-[#0B6E4F] bg-[#EBF7F2]/60"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <div className="flex items-center gap-2 font-bold text-sm text-gray-900">
              <Users className="h-4 w-4 text-[#0B6E4F]" />
              Nearest 3 verified artisans
            </div>
            <p className="mt-1 text-xs text-gray-600">
              Sends to 3 nearby Online artisans at once (60s per round, up to 3 rounds).
              First to accept wins.
            </p>
          </button>

          {targetArtisanId ? (
            <button
              type="button"
              onClick={() => setDispatchMode("direct")}
              className={`rounded-xl border-2 p-3.5 text-left transition ${
                dispatchMode === "direct"
                  ? "border-[#0B6E4F] bg-[#EBF7F2]/60"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-sm text-gray-900">
                <ShieldCheck className="h-4 w-4 text-[#0B6E4F]" />
                Direct: {targetArtisanName ?? "Selected artisan"}
              </div>
              <p className="mt-1 text-xs text-gray-600">
                Send this request exclusively to the verified artisan you picked.
              </p>
            </button>
          ) : null}
        </div>
      </div>

      {/* Trade */}
      <div>
        <label htmlFor="job-trade" className="mb-1 block text-sm font-semibold text-gray-800">
          Trade needed
        </label>
        <select
          id="job-trade"
          value={trade}
          disabled={dispatchMode === "direct" && Boolean(targetArtisanId)}
          onChange={(e) => setTrade(e.target.value as ArtisanTrade)}
          className="min-h-12 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-base disabled:bg-gray-100"
        >
          {TRADES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Description */}
      <div>
        <label htmlFor="job-desc" className="mb-1 block text-sm font-semibold text-gray-800">
          What do you need done?
        </label>
        <textarea
          id="job-desc"
          rows={3}
          required
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Kitchen sink pipe is leaking under the cabinet and needs a replacement trap and seal."
          className="w-full rounded-xl border border-gray-300 p-3.5 text-sm focus:border-[#0B6E4F] focus:outline-none focus:ring-2 focus:ring-[#0B6E4F]/20"
        />
      </div>

      {/* Up to 3 Photos (EXIF stripped + compressed <= 300 KB) */}
      <div>
        <label htmlFor="job-photos" className="mb-1 block text-sm font-semibold text-gray-800">
          Photos (optional, up to {MAX_JOB_PHOTOS})
        </label>
        <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3.5 py-3 text-sm text-gray-700 hover:bg-gray-100">
          <span className="flex items-center gap-2 truncate">
            <Camera className="h-4 w-4 shrink-0 text-[#0B6E4F]" />
            <span className="truncate">
              {photos.length > 0
                ? `${photos.length} photo(s) selected: ${photos.map((p) => p.name).join(", ")}`
                : "Add up to 3 photos (EXIF stripped & compressed to ~300 KB)"}
            </span>
          </span>
          <input
            id="job-photos"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => handlePhotosChange(e.target.files)}
            className="sr-only"
          />
          <span className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-[#0B6E4F] shadow-xs">
            Choose
          </span>
        </label>
      </div>

      {/* Location pin + General area + Private Exact Address */}
      <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
            <MapPin className="h-4 w-4 text-[#0B6E4F]" />
            Address &amp; Location Pin
          </span>
          <button
            type="button"
            disabled={locating}
            onClick={handleUseGpsPin}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#0B6E4F] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#08523B] disabled:opacity-60"
          >
            <Navigation className="h-3.5 w-3.5" />
            {locating ? "Pinning..." : "Use my GPS pin"}
          </button>
        </div>

        <select
          aria-label="Pick Nigerian area preset"
          defaultValue=""
          onChange={(e) => {
            const p = NIGERIA_CITY_PRESETS.find((item) => item.label === e.target.value);
            if (p) {
              setCoords({ lat: p.lat, lng: p.lng });
              if (!approxAreaLabel) setApproxAreaLabel(p.label);
            }
          }}
          className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-xs text-gray-800"
        >
          <option value="" disabled>
            Or choose a Nigerian area pin...
          </option>
          {NIGERIA_CITY_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </select>

        <p className="font-mono text-[11px] text-gray-500">
          Approx. search pin (~100m): {roundCoordTo100m(coords.lat).toFixed(3)},{" "}
          {roundCoordTo100m(coords.lng).toFixed(3)}
        </p>

        <div>
          <label htmlFor="approxArea" className="mb-1 block text-xs font-semibold text-gray-800">
            General area / neighbourhood (shown before acceptance)
          </label>
          <input
            id="approxArea"
            type="text"
            required
            value={approxAreaLabel}
            onChange={(e) => setApproxAreaLabel(e.target.value)}
            placeholder="e.g. Allen Avenue area, Ikeja, Lagos"
            className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm"
          />
        </div>

        <div>
          <label htmlFor="exactAddress" className="mb-1 block text-xs font-semibold text-gray-800">
            Exact street address &amp; gate instructions (HIDDEN until accepted)
          </label>
          <input
            id="exactAddress"
            type="text"
            required
            value={exactAddress}
            onChange={(e) => setExactAddress(e.target.value)}
            placeholder="e.g. Flat 3B, 14 Toyin Street, Ikeja (blue gate)"
            className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm"
          />
          <p className="mt-1 text-[11px] text-[#08523B]">
            Protected by row-level security: artisans cannot see your exact street address
            until they accept the job.
          </p>
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
        disabled={submitting}
        className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[#0B6E4F] px-4 py-3 text-base font-bold text-white transition hover:bg-[#08523B] disabled:opacity-60"
      >
        {submitting
          ? "Compressing photos & notifying artisans..."
          : dispatchMode === "direct"
            ? "Send direct request"
            : "Send to nearest 3 verified artisans"}
      </button>
    </form>
  );
}
