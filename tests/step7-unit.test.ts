import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("Step 7 — Migration static security & ratings rules audit", () => {
  it("enforces RLS on reviews, confirmed-only rating, 1-5 stars, one review per side per job, and server-side avg/count update", () => {
    const sqlPath = path.resolve(
      __dirname,
      "../supabase/migrations/0007_step7_ratings_reviews.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf8");

    expect(sql).toContain("alter table public.reviews enable row level security;");
    expect(sql).toContain("alter table public.reviews force row level security;");
    expect(sql).toContain("check (rating between 1 and 5)");
    expect(sql).toContain("constraint reviews_one_per_side_per_job unique (job_id, reviewer_role)");
    expect(sql).toContain("if v_job.status <> 'confirmed' then");
    expect(sql).toContain("rating_avg = v_avg");
    expect(sql).toContain("rating_count = v_cnt");
    expect(sql).toContain("is_anonymized boolean not null default false");
    expect(sql).toContain("get_artisan_public_profile");
  });
});
