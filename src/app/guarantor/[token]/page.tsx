import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { GuarantorConfirmClient } from "@/components/GuarantorConfirmClient";
import { hashGuarantorToken } from "@/lib/guarantor";
import { maskPhoneForUi } from "@/lib/phone";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Guarantor Confirmation",
};

export default async function GuarantorConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isSupabaseAdminConfigured() || !token || token.length < 16) {
    return (
      <div className="flex min-h-dvh flex-col bg-[#F8FAF9]">
        <Header />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8">
          <div className="rounded-2xl border border-gray-200/80 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-bold text-gray-900">Invalid guarantor link</h1>
            <p className="mt-2 text-sm text-gray-600">
              This confirmation link is invalid or has expired. Ask the artisan to
              resend their verification request.
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-[#0B6E4F] px-4 py-2 text-xs font-semibold text-white"
            >
              Go to Oníṣẹ́ ọwọ́
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const admin = createSupabaseAdminClient();
  const tokenHash = hashGuarantorToken(token);

  const { data: guarantor } = await admin
    .from("guarantor_verifications")
    .select("artisan_id, guarantor_name, guarantor_phone_e164, status, confirmed_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!guarantor) {
    return (
      <div className="flex min-h-dvh flex-col bg-[#F8FAF9]">
        <Header />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8">
          <div className="rounded-2xl border border-gray-200/80 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-bold text-gray-900">Link not found</h1>
            <p className="mt-2 text-sm text-gray-600">
              This guarantor confirmation link is no longer valid.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const { data: artisan } = await admin
    .from("artisan_profiles")
    .select("full_name, trade, work_area")
    .eq("user_id", guarantor.artisan_id)
    .maybeSingle();

  return (
    <div className="flex min-h-dvh flex-col bg-[#F8FAF9]">
      <Header />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-8">
        <GuarantorConfirmClient
          token={token}
          guarantorName={guarantor.guarantor_name}
          artisanFullName={artisan?.full_name ?? "An artisan"}
          artisanTrade={artisan?.trade ?? "artisan"}
          artisanWorkArea={artisan?.work_area ?? "Nigeria"}
          maskedPhone={maskPhoneForUi(guarantor.guarantor_phone_e164)}
          initialStatus={guarantor.status}
          initialConfirmedAt={guarantor.confirmed_at}
        />
      </main>
    </div>
  );
}
