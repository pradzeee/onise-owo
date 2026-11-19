import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { generateAckToken, verifyAckTokenHash } from "@/lib/alerts";
import {
  DISCOVERY_RADIUS_METERS,
  HEARTBEAT_INTERVAL_MS,
  OFFLINE_TIMEOUT_MINUTES,
  PUSH_FALLBACK_SMS_SECONDS,
  formatDistanceMeters,
  roundCoordTo100m,
  validateCoordinates,
} from "@/lib/location";

describe("Step 3 — Location rounding (~100 m) & constants", () => {
  it("rounds coordinates to 3 decimal places (~100 m) with no high-precision leak", () => {
    expect(roundCoordTo100m(6.6024891)).toBe(6.602);
    expect(roundCoordTo100m(3.3518912)).toBe(3.352);
    expect(validateCoordinates(6.6024891, 3.3518912)).toEqual({
      lat: 6.602,
      lng: 3.352,
    });
  });

  it("rejects out-of-range or NaN coordinates", () => {
    expect(() => validateCoordinates(95, 3.35)).toThrow();
    expect(() => validateCoordinates(6.6, 200)).toThrow();
    expect(() => validateCoordinates(Number.NaN, 3.35)).toThrow();
  });

  it("formats distances cleanly and enforces spec timings/radii", () => {
    expect(formatDistanceMeters(120)).toBe("< 200 m away");
    expect(formatDistanceMeters(640)).toBe("650 m away");
    expect(formatDistanceMeters(2380)).toBe("2.4 km away");
    expect(HEARTBEAT_INTERVAL_MS).toBe(60_000);
    expect(OFFLINE_TIMEOUT_MINUTES).toBe(15);
    expect(DISCOVERY_RADIUS_METERS).toBe(10_000);
    expect(PUSH_FALLBACK_SMS_SECONDS).toBe(30);
  });
});

describe("Step 3 — Web Push delivery ack token verification", () => {
  it("verifies valid ack tokens and rejects tampered tokens", () => {
    const { rawToken, tokenHash } = generateAckToken();
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyAckTokenHash(rawToken, tokenHash)).toBe(true);
    expect(verifyAckTokenHash(`${rawToken}x`, tokenHash)).toBe(false);
    expect(verifyAckTokenHash("", tokenHash)).toBe(false);
  });
});

describe("Step 3 — Migration static security & PostGIS audit", () => {
  it("enforces RLS on new tables, ~100m rounding, 15-min timeout, 10 km discovery, and atomic 30s SMS fallback", () => {
    const sqlPath = path.resolve(
      __dirname,
      "../supabase/migrations/0003_step3_location_online_alerts.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf8");

    for (const table of ["push_subscriptions", "alert_deliveries"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`alter table public.${table} force row level security;`);
    }

    // Single rounded point (~100m), no location history table
    expect(sql).toContain("round(p_lat::numeric, 3)");
    expect(sql).toContain("round(p_lng::numeric, 3)");
    expect(sql).not.toMatch(/create table.*location_history/i);

    // 15-minute offline timeout + 10 km max discovery + sort by distance then rating
    expect(sql).toContain("interval '15 minutes'");
    expect(sql).toContain("least(greatest(coalesce(p_radius_meters, 10000), 500), 10000)");
    expect(sql).toContain("st_distance(ap.approx_location, v_origin) asc");
    expect(sql).toContain("p.rating_avg desc");

    // 30-second SMS backup with atomic SKIP LOCKED claim
    expect(sql).toContain("interval '30 seconds'");
    expect(sql).toContain("for update skip locked");

    // Never return phone numbers in find_nearby_artisans
    const findBlock = sql.slice(sql.indexOf("create or replace function public.find_nearby_artisans"));
    const findEnd = findBlock.indexOf("$$;");
    expect(findBlock.slice(0, findEnd)).not.toMatch(/\bphone\b/i);
  });
});
