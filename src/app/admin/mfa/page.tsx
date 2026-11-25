import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminMfaClient } from "@/components/AdminMfaClient";
import { Header } from "@/components/Header";
import { checkAdminTwoStep } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin Two-Step Verification",
};

export default async function AdminMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const check = await checkAdminTwoStep();
  if (!check.authenticated) {
    redirect("/login");
  }
  if (!check.isAdmin) {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const safeNext =
    sp.next && sp.next.startsWith("/admin") ? sp.next : "/admin";

  if (check.mfaVerified) {
    redirect(safeNext);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#F8FAF9]">
      <Header isAuthenticated roleLabel="admin" />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8">
        <AdminMfaClient nextPath={safeNext} />
      </main>
    </div>
  );
}
