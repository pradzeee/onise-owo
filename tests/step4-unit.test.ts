import fs from "fs";
import path from "path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  TARGET_JOB_PHOTO_MAX_BYTES,
  stripExifAndCompressJobPhoto,
} from "@/lib/image";
import {
  calculateCancelFeeKobo,
  createStartCodeMaterial,
  deriveCustomerStartCode,
  generateJobShareToken,
  hashJobShareToken,
  hashStartCode,
} from "@/lib/jobs";

describe("Step 4 — Photo EXIF stripping & <=300 KB compression", () => {
  it("strips EXIF metadata and compresses large images to <= 300 KB", async () => {
    // Generate a large noisy 2000x1500 JPEG with embedded EXIF camera/GPS text
    const rawPixels = Buffer.alloc(2000 * 1500 * 3);
    for (let i = 0; i < rawPixels.length; i += 3) {
      rawPixels[i] = (i * 17) % 256;
      rawPixels[i + 1] = (i * 31) % 256;
      rawPixels[i + 2] = (i * 47) % 256;
    }

    const inputWithExif = await sharp(rawPixels, {
      raw: { width: 2000, height: 1500, channels: 3 },
    })
      .withExif({
        IFD0: {
          Make: "TestPhoneCamera",
          ImageDescription: "Private Home Address EXIF Leak",
        },
      })
      .jpeg({ quality: 95 })
      .toBuffer();

    const beforeMeta = await sharp(inputWithExif).metadata();
    expect(beforeMeta.exif).toBeDefined();

    const processed = await stripExifAndCompressJobPhoto(inputWithExif);
    expect(processed.contentType).toBe("image/jpeg");
    expect(processed.sizeBytes).toBeLessThanOrEqual(TARGET_JOB_PHOTO_MAX_BYTES);

    const afterMeta = await sharp(processed.buffer).metadata();
    expect(afterMeta.exif).toBeUndefined();
  });
});

describe("Step 4 — 4-digit Start Code hashing, Share tokens & Cancel Fee math", () => {
  it("derives deterministic 4-digit start codes and verifies strictly via HMAC hash", () => {
    const jobId = "11111111-2222-3333-4444-555555555555";
    const { nonce, startCode, startCodeHash } = createStartCodeMaterial(jobId);

    expect(startCode).toMatch(/^\d{4}$/);
    expect(startCodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(startCodeHash).not.toContain(startCode);
    expect(deriveCustomerStartCode(jobId, nonce)).toBe(startCode);
    expect(hashStartCode(jobId, startCode)).toBe(startCodeHash);
    expect(hashStartCode(jobId, startCode === "9999" ? "1000" : "9999")).not.toBe(
      startCodeHash,
    );
  });

  it("enforces Terms cancellation fee rules in whole kobo", () => {
    // Free before en_route
    expect(
      calculateCancelFeeKobo({
        cancelledByRole: "customer",
        jobStatus: "quote_accepted",
        acceptedAmountKobo: 2_000_000,
      }),
    ).toBe(0);

    // After en_route: 10% clamped between ₦1,000 (100,000) and ₦5,000 (500,000)
    expect(
      calculateCancelFeeKobo({
        cancelledByRole: "customer",
        jobStatus: "en_route",
        acceptedAmountKobo: 500_000, // ₦5,000 -> 10% = ₦500 -> min ₦1,000
      }),
    ).toBe(100_000);

    expect(
      calculateCancelFeeKobo({
        cancelledByRole: "customer",
        jobStatus: "en_route",
        acceptedAmountKobo: 2_500_000, // ₦25,000 -> 10% = ₦2,500
      }),
    ).toBe(250_000);

    expect(
      calculateCancelFeeKobo({
        cancelledByRole: "customer",
        jobStatus: "arrived",
        acceptedAmountKobo: 10_000_000, // ₦100,000 -> 10% = ₦10,000 -> max ₦5,000
      }),
    ).toBe(500_000);

    // Artisan cancelling charges 0 fee to customer
    expect(
      calculateCancelFeeKobo({
        cancelledByRole: "artisan",
        jobStatus: "en_route",
        acceptedAmountKobo: 2_500_000,
      }),
    ).toBe(0);
  });

  it("hashes share link tokens safely", () => {
    const { rawToken, tokenHash } = generateJobShareToken();
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashJobShareToken(rawToken)).toBe(tokenHash);
  });
});

describe("Step 4 — Migration static security & state machine audit", () => {
  it("enforces RLS on all Step 4 tables, exact statuses, atomic accept, and address gating", () => {
    const sqlPath = path.resolve(
      __dirname,
      "../supabase/migrations/0004_step4_jobs_requests_quotes.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf8");

    for (const table of [
      "jobs",
      "job_private_addresses",
      "job_requests",
      "quotes",
      "trusted_contacts",
      "job_shares",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`alter table public.${table} force row level security;`);
    }

    // All 14 exact job statuses
    for (const st of [
      "requested",
      "accepted",
      "quoted",
      "quote_accepted",
      "paid",
      "en_route",
      "arrived",
      "in_progress",
      "completed",
      "confirmed",
      "cancelled",
      "expired",
      "disputed",
      "refunded",
    ]) {
      expect(sql).toContain(`'${st}'`);
    }

    // All 5 exact request statuses
    for (const rst of ["sent", "accepted", "declined", "expired", "taken"]) {
      expect(sql).toContain(`'${rst}'`);
    }

    // One atomic UPDATE setting artisan_id only where artisan_id is null
    expect(sql).toContain("and artisan_id is null");
    expect(sql).toContain("and status = 'requested'");

    // Private job photos bucket + max 3 photos
    expect(sql).toContain("'job-photos'");
    expect(sql).toContain("cardinality(photo_paths) <= 3");

    // 60s waves up to 3 rounds
    expect(sql).toContain("interval '60 seconds'");
    expect(sql).toContain("v_job.dispatch_round < 3");
  });
});
