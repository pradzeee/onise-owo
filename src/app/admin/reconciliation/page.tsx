import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Scale } from "lucide-react";
import { AdminReconciliationClient } from "@/components/AdminReconciliationClient";
import { Header } from "@/components/Header";
import type { ReconciliationReportRecord } from "@/lib/constants";
import { checkAdminTwoStep } from "@/lib/admin-auth";
import { getLagosDateString } from "@/lib/reconciliation";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin — Payment Reconciliation",
};

export default async function AdminReconciliationPage() {
  if (!isSupabaseServerConfigured()) {
    redirect("/login");
  }

  const check = await checkAdminTwoStep();
  if (!check.authenticated) {
    redirect("/login");
  }
  if (!check.isAdmin) {
    redirect("/dashboard");
  }
  if (!check.mfaVerified) {
    redirect("/admin/mfa?next=/admin/reconciliation");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, account_status")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "admin" || profile.account_status !== "active") {
    redirect("/dashboard");
  }

  const { data: reports } = await supabase
    .from("reconciliation_reports")
    .select("*")
    .order("report_date", { ascending: false })
    .limit(30);

  return (
    <div className="flex min-h-dvh flex-col">
      <Header isAuthenticated roleLabel="admin" />

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6 sm:py-8">
        <div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </Link>
          <div className="mt-2 flex items-center gap-2">
            <Scale className="h-6 w-6 text-[#0B6E4F]" />
            <h1 className="text-2xl font-extrabold text-gray-900">
              Daily Paystack Reconciliation
            </h1>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Compares Oníṣẹ́ ọwọ́&apos;s verified whole-kobo payment ledger against Paystack
            settled transactions each Africa/Lagos day.
          </p>
        </div>

        <AdminReconciliationClient
          reports={(reports ?? []) as ReconciliationReportRecord[]}
          defaultDate={getLagosDateString()}
        />
      </main>
    </div>
  );
}
