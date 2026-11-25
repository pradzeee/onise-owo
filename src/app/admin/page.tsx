import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import {
  AdminDashboardClient,
  type SafetySuspensionRow,
  type UserReportRow,
} from "@/components/AdminDashboardClient";
import { Header } from "@/components/Header";
import { checkAdminTwoStep } from "@/lib/admin-auth";
import type {
  ArtisanProfileRecord,
  AuditLogRecord,
  DisputeRecord,
  JobRecord,
  ProfileRecord,
} from "@/lib/constants";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin Dashboard",
};

export default async function AdminDashboardPage() {
  const check = await checkAdminTwoStep();
  if (!check.authenticated) {
    redirect("/login");
  }
  if (!check.isAdmin) {
    redirect("/dashboard");
  }
  if (!check.mfaVerified) {
    redirect("/admin/mfa?next=/admin");
  }

  // All reads execute under the authenticated admin's JWT (RLS enforces public.is_admin)
  const supabase = await createSupabaseServerClient();

  const [
    { data: pendingArtisans },
    { data: users },
    { data: jobs },
    { data: disputes },
    { data: reports },
    { data: suspensions },
    { data: auditLogs },
  ] = await Promise.all([
    supabase
      .from("artisan_profiles")
      .select("*")
      .eq("verification_status", "pending")
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("jobs")
      .select(
        "id, customer_id, artisan_id, trade, description, approx_area_label, status, accepted_amount_kobo, cancel_fee_kobo, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("disputes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("user_reports")
      .select("id, reporter_id, reported_user_id, job_id, category, details, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("safety_suspensions")
      .select("*")
      .order("human_review_due_at", { ascending: true })
      .limit(50),
    supabase
      .from("audit_log")
      .select("id, actor_id, action, target_type, target_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  return (
    <div className="flex min-h-dvh flex-col bg-[#F8FAF9]">
      <Header isAuthenticated roleLabel="admin" />

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs sm:p-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-200 hover:text-gray-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </Link>
          <div className="mt-3 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-[#0B6E4F]" />
            <h1 className="text-xl font-black tracking-tight text-gray-900 sm:text-2xl">
              Oníṣẹ́ ọwọ́ Admin Dashboard
            </h1>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Two-step verified session active. Every action is recorded in{" "}
            <code className="font-mono text-xs">audit_log</code>. Urgent safety
            suspensions apply immediately and require human review within 2 business days.
          </p>
        </div>

        <AdminDashboardClient
          pendingArtisans={(pendingArtisans ?? []) as ArtisanProfileRecord[]}
          users={(users ?? []) as ProfileRecord[]}
          jobs={(jobs ?? []) as JobRecord[]}
          disputes={(disputes ?? []) as DisputeRecord[]}
          reports={(reports ?? []) as UserReportRow[]}
          suspensions={(suspensions ?? []) as SafetySuspensionRow[]}
          auditLogs={(auditLogs ?? []) as AuditLogRecord[]}
        />
      </main>
    </div>
  );
}
