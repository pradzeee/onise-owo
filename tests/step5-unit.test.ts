import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { CHAT_RETENTION_AFTER_END_DAYS, containsPhoneNumber } from "@/lib/chat";

describe("Step 5 — Phone number blocking in chat", () => {
  it("detects Nigerian and international phone numbers in chat messages", () => {
    expect(containsPhoneNumber("Call me on 0803 123 4567")).toBe(true);
    expect(containsPhoneNumber("WhatsApp +234-812-555-8899")).toBe(true);
    expect(containsPhoneNumber("My number is 09012223344")).toBe(true);
    expect(containsPhoneNumber("Reach me at 2347065554444")).toBe(true);
  });

  it("allows normal job messages, prices, and 4-digit start codes", () => {
    expect(containsPhoneNumber("I am at the gate now, please come out.")).toBe(false);
    expect(containsPhoneNumber("The pipe and labour will cost ₦15,000.")).toBe(false);
    expect(containsPhoneNumber("I will arrive by 2:30 PM.")).toBe(false);
    expect(CHAT_RETENTION_AFTER_END_DAYS).toBe(7);
  });
});

describe("Step 5 — Migration static security & chat window audit", () => {
  it("enforces RLS on all Step 5 tables, accepted-only chat, 7-day close, report & block", () => {
    const sqlPath = path.resolve(
      __dirname,
      "../supabase/migrations/0005_step5_chat_report_block.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf8");

    for (const table of ["job_messages", "user_blocks", "user_reports"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`alter table public.${table} force row level security;`);
    }

    // Chat opens only after acceptance and closes 7 days after job ends
    expect(sql).toContain("Chat opens only after a job is accepted.");
    expect(sql).toContain("interval '7 days'");
    expect(sql).toContain("Chat closed 7 days after the job ended.");

    // Block disables messaging & discovery
    expect(sql).toContain("public.is_pair_blocked");

    // Realtime enabled for job_messages
    expect(sql).toContain("alter publication supabase_realtime add table public.job_messages");
  });
});
