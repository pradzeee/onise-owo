import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import {
  AdminVerificationsClient,
  type AdminApplicationItem,
} from "@/components/AdminVerificationsClient";
import { Header } from "@/components/Header";
import type {
  ArtisanProfileRecord,
  ArtisanVerificationRecord,
  AuditLogRecord,
  GuarantorVerificationRecord,
} from "@/lib/constants";
import { checkAdminTwoStep } from "@/lib/admin-auth";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin — Artisan Verifications",
};

export default async function AdminVerificationsPage() {
  if (!isSupabaseServerConfigured()) {
    redirect("/login");
  }

  const check = await checkAdminTwoStep();
  if (!check.authenticated) {
    redirect("/login");
  }
  if (check.isAdmin && !check.mfaVerified) {
    redirect("/admin/mfa?next=/admin/verifications");
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
    return (
      <div className="flex min-h-dvh flex-col">
        <Header isAuthenticated roleLabel={profile?.role ?? null} />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8">
          <div className="rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-bold text-gray-900">Admin access required</h1>
            <p className="mt-2 text-sm text-gray-600">
              Only manually designated database administrators can review artisan
              verifications.
            </p>
            <Link
              href="/dashboard"
              className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-[#0B6E4F] px-4 py-2 text-xs font-semibold text-white"
            >
              Return to dashboard
            </Link>
          </div>
        </main>
      </div>
    );
  }

  // Queries run under the authenticated admin's JWT — RLS enforces public.is_admin(auth.uid())
  const [{ data: artisans }, { data: verifications }, { data: guarantors }, { data: logs }] =
    await Promise.all([
      supabase
        .from("artisan_profiles")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(100),
      supabase
        .from("artisan_verifications")
        .select(
          "id, user_id, provider_name, provider_reference, provider_status, liveness_passed, face_match_passed, checked_at, created_at, updated_at",
        ),
      supabase
        .from("guarantor_verifications")
        .select("id, artisan_id, guarantor_name, status, confirmed_at, sms_sent_at, created_at, updated_at"),
      supabase
        .from("audit_log")
        .select("id, actor_id, action, target_type, target_id, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

  const verifMap = new Map<string, ArtisanVerificationRecord>();
  for (const v of (verifications ?? []) as ArtisanVerificationRecord[]) {
    verifMap.set(v.user_id, v);
  }

  const guarantorMap = new Map<string, GuarantorVerificationRecord>();
  for (const g of (guarantors ?? []) as GuarantorVerificationRecord[]) {
    guarantorMap.set(g.artisan_id, g);
  }

  const applications: AdminApplicationItem[] = ((artisans ?? []) as ArtisanProfileRecord[]).map(
    (artisan) => ({
      artisan,
      verification: verifMap.get(artisan.user_id) ?? null,
      guarantor: guarantorMap.get(artisan.user_id) ?? null,
    }),
  );

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
            <ShieldCheck className="h-6 w-6 text-[#0B6E4F]" />
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">
              Artisan Verification Review
            </h1>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Private selfies open only through 60-second signed links logged to{" "}
            <code className="font-mono text-xs">audit_log</code>. Artisans can be
            approved only after NIN face match + liveness pass AND guarantor confirms.
          </p>
        </div>

        <AdminVerificationsClient
          applications={applications}
          auditLogs={(logs ?? []) as AuditLogRecord[]}
        />
      </main>
    </div>
  );
}
