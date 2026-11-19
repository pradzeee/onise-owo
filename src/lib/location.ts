/**
 * Location helpers — pure client-safe utilities (zero Node.js dependencies).
 * Coordinates are rounded to 0.001 degrees (~100 metres) and stored as a single
 * point with no location history.
 */

export const HEARTBEAT_INTERVAL_MS = 60_000; // 60 seconds
export const OFFLINE_TIMEOUT_MINUTES = 15;
export const DISCOVERY_RADIUS_METERS = 10_000; // 10 km
export const PUSH_FALLBACK_SMS_SECONDS = 30;

export const NIGERIA_CITY_PRESETS = [
  { label: "Ikeja, Lagos", lat: 6.602, lng: 3.351 },
  { label: "Victoria Island / Lekki, Lagos", lat: 6.431, lng: 3.421 },
  { label: "Yaba / Surulere, Lagos", lat: 6.509, lng: 3.371 },
  { label: "Wuse, Abuja", lat: 9.076, lng: 7.479 },
  { label: "Ibadan, Oyo", lat: 7.378, lng: 3.947 },
  { label: "Port Harcourt, Rivers", lat: 4.815, lng: 7.049 },
  { label: "Kano", lat: 12.002, lng: 8.592 },
  { label: "Enugu", lat: 6.458, lng: 7.546 },
] as const;

export const DEFAULT_NIGERIA_CENTER = { lat: 6.602, lng: 3.351 };

/**
 * Rounds latitude or longitude to 3 decimal places (~111 m lat / ~109 m lng in Nigeria).
 */
export function roundCoordTo100m(coord: number): number {
  if (!Number.isFinite(coord)) {
    throw new Error("Coordinate must be a finite number.");
  }
  return Math.round(coord * 1000) / 1000;
}

export function validateCoordinates(lat: number, lng: number): {
  lat: number;
  lng: number;
} {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("Latitude must be between -90 and 90.");
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error("Longitude must be between -180 and 180.");
  }
  return {
    lat: roundCoordTo100m(lat),
    lng: roundCoordTo100m(lng),
  };
}

/**
 * Formats integer distance in metres for Nigerian mobile UI.
 */
export function formatDistanceMeters(meters: number): string {
  const safe = Math.max(0, Math.round(meters));
  if (safe < 200) return "< 200 m away";
  if (safe < 1000) return `${Math.round(safe / 50) * 50} m away`;
  return `${(safe / 1000).toFixed(1)} km away`;
}
