"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MapPin, Navigation, ShieldCheck, Star } from "lucide-react";
import { TRADES, type ArtisanTrade, type NearbyArtisanResult } from "@/lib/constants";
import {
  DEFAULT_NIGERIA_CENTER,
  DISCOVERY_RADIUS_METERS,
  NIGERIA_CITY_PRESETS,
  formatDistanceMeters,
  roundCoordTo100m,
} from "@/lib/location";

const NearbyArtisansMap = dynamic(
  () => import("./NearbyArtisansMap").then((m) => m.NearbyArtisansMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-72 w-full items-center justify-center rounded-2xl border border-gray-200 bg-gray-100 text-xs text-gray-500 sm:h-80">
        Loading OpenStreetMap...
      </div>
    ),
  },
);

export function FindArtisansClient() {
  const [trade, setTrade] = useState<ArtisanTrade>("plumber");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState<string>("");
  const [artisans, setArtisans] = useState<NearbyArtisanResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNearby = useCallback(
    async (nextTrade: ArtisanTrade, targetCoords: { lat: number; lng: number }) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          trade: nextTrade,
          lat: String(roundCoordTo100m(targetCoords.lat)),
          lng: String(roundCoordTo100m(targetCoords.lng)),
          radius: String(DISCOVERY_RADIUS_METERS),
        });

        const res = await fetch(`/api/artisans/nearby?${params.toString()}`);
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          artisans?: NearbyArtisanResult[];
        };

        if (!res.ok) {
          setError(data.error ?? "Could not load nearby artisans.");
          setArtisans([]);
          return;
        }

        setArtisans(data.artisans ?? []);
      } catch {
        setError("Network error searching nearby artisans.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Re-fetch automatically when trade or coordinates change
  useEffect(() => {
    if (!coords) return;
    fetchNearby(trade, coords);
  }, [trade, coords, fetchNearby]);

  async function handleRequestBrowserLocation() {
    if (locating) return;
    setLocating(true);
    setError(null);

    try {
      // 1. Save withdrawable 'location' consent
      await fetch("/api/consents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consentType: "location", granted: true }),
      }).catch(() => {});

      if (!("geolocation" in navigator)) {
        setError("Your browser does not support GPS. Pick a Nigerian area below instead.");
        return;
      }

      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 12_000,
          maximumAge: 60_000,
        });
      });

      const rounded = {
        lat: roundCoordTo100m(pos.coords.latitude),
        lng: roundCoordTo100m(pos.coords.longitude),
      };
      setCoords(rounded);
      setLocationLabel(
        `Your GPS area (${rounded.lat.toFixed(3)}, ${rounded.lng.toFixed(3)})`,
      );
    } catch {
      setError(
        "Browser location permission was denied or unavailable. Choose an area preset below to browse nearby artisans.",
      );
    } finally {
      setLocating(false);
    }
  }

  function handleSelectPreset(preset: (typeof NIGERIA_CITY_PRESETS)[number]) {
    setError(null);
    setCoords({ lat: preset.lat, lng: preset.lng });
    setLocationLabel(preset.label);
  }

  return (
    <div className="space-y-5">
      {/* Trade selector */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
          1. Pick a trade
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {TRADES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTrade(t.id)}
              className={`min-h-10 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                trade === t.id
                  ? "bg-[#0B6E4F] text-white"
                  : "border border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {/* Location permission step */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
          2. Choose search area (within 10 km)
        </p>
        <p className="mt-1 text-xs text-gray-600">
          We ask browser permission before reading your location and round it to ~100 m
          with no location history stored.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={locating}
            onClick={handleRequestBrowserLocation}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#0B6E4F] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#08523B] disabled:opacity-60"
          >
            <Navigation className="h-4 w-4" />
            {locating ? "Getting location..." : "Use my current location"}
          </button>

          <select
            aria-label="Or pick a Nigerian city area"
            defaultValue=""
            onChange={(e) => {
              const found = NIGERIA_CITY_PRESETS.find((p) => p.label === e.target.value);
              if (found) handleSelectPreset(found);
            }}
            className="min-h-11 rounded-xl border border-gray-300 bg-white px-3 text-xs font-medium text-gray-800 focus:border-[#0B6E4F] focus:outline-none"
          >
            <option value="" disabled>
              Or pick an area in Nigeria...
            </option>
            {NIGERIA_CITY_PRESETS.map((preset) => (
              <option key={preset.label} value={preset.label}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>

        {locationLabel ? (
          <p className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-[#08523B]">
            <MapPin className="h-3.5 w-3.5" />
            Searching within 10 km of: <strong>{locationLabel}</strong>
          </p>
        ) : null}
      </section>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"
        >
          {error}
        </div>
      ) : null}

      {/* Map + Results */}
      {coords ? (
        <>
          <NearbyArtisansMap
            center={coords ?? DEFAULT_NIGERIA_CENTER}
            artisans={artisans}
            selectedArtisanId={selectedId}
            onSelectArtisan={setSelectedId}
          />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">
                Verified Online Artisans ({artisans.length})
              </h2>
              <span className="text-[11px] text-gray-500">
                Sorted by distance, then rating
              </span>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-[#EBF7F2]/70 p-3 text-xs text-[#08523B]">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                <p>
                  Artisan phone numbers and your exact address stay hidden until a job is
                  accepted.
                </p>
                {artisans.length > 0 ? (
                  <Link
                    href={`/jobs/new?trade=${encodeURIComponent(trade)}&lat=${coords.lat}&lng=${coords.lng}&area=${encodeURIComponent(locationLabel)}`}
                    className="inline-flex min-h-9 shrink-0 items-center rounded-lg bg-[#0B6E4F] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#08523B]"
                  >
                    Request nearest 3
                  </Link>
                ) : null}
              </div>
            </div>

            {loading ? (
              <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                Searching verified artisans within 10 km...
              </div>
            ) : artisans.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-600">
                No verified, Online{" "}
                <strong className="capitalize">{trade.replace("_", " ")}s</strong> found
                within 10 km right now. Try another trade or area.
              </div>
            ) : (
              <div className="space-y-3">
                {artisans.map((artisan) => {
                  const initials = artisan.full_name
                    .split(" ")
                    .map((s) => s[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();

                  return (
                    <article
                      key={artisan.artisan_id}
                      onClick={() => setSelectedId(artisan.artisan_id)}
                      className={`flex cursor-pointer items-center gap-3.5 rounded-2xl border bg-white p-4 shadow-xs transition ${
                        selectedId === artisan.artisan_id
                          ? "border-[#0B6E4F] ring-2 ring-[#0B6E4F]/15"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      {artisan.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={artisan.photo_url}
                          alt={artisan.full_name}
                          className="h-14 w-14 shrink-0 rounded-full border border-gray-200 object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#EBF7F2] text-sm font-bold text-[#08523B]">
                          {initials}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-bold text-gray-900">
                            {artisan.full_name}
                          </h3>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            <ShieldCheck className="h-3 w-3" />
                            Verified
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-gray-600">
                          {artisan.work_area} •{" "}
                          <strong>{formatDistanceMeters(artisan.distance_meters)}</strong>
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1 text-xs font-semibold text-amber-700">
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                            {artisan.rating_count > 0 ? (
                              <span>
                                {artisan.rating_avg.toFixed(1)} ({artisan.rating_count}{" "}
                                reviews)
                              </span>
                            ) : (
                              <span className="text-gray-500 font-normal">
                                New verified artisan
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/artisans/${encodeURIComponent(artisan.artisan_id)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex min-h-9 items-center rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              Profile
                            </Link>
                            <Link
                              href={`/jobs/new?trade=${encodeURIComponent(trade)}&lat=${coords.lat}&lng=${coords.lng}&area=${encodeURIComponent(locationLabel)}&artisanId=${encodeURIComponent(artisan.artisan_id)}&artisanName=${encodeURIComponent(artisan.full_name)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex min-h-9 items-center rounded-lg border border-[#0B6E4F] bg-white px-3 py-1 text-xs font-bold text-[#0B6E4F] hover:bg-[#EBF7F2]"
                            >
                              Request
                            </Link>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">
          Tap <strong>Use my current location</strong> or select a Nigerian area above to
          see verified, Online artisans within 10 km.
        </div>
      )}
    </div>
  );
}
