import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock, ShieldCheck, Sparkles } from "lucide-react";
import { Header } from "@/components/Header";
import { LoginForm } from "@/components/LoginForm";
import { APP_NAME } from "@/lib/constants";
import { isFirebaseServerConfigured } from "@/lib/firebase/server";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Log in",
};

export default async function LoginPage() {
  const configured = isSupabaseServerConfigured();
  const firebaseConfigured = isFirebaseServerConfigured();
  const supabaseConfigured = isRealSupabaseConfigured();

  if (configured) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      redirect(profile?.role ? "/dashboard" : "/onboarding");
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#F8FAF9]">
      <Header />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8 sm:py-12">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-[#EBF7F2] px-3 py-1 text-xs font-bold text-[#08523B]">
            <Sparkles className="h-3.5 w-3.5 text-[#0B6E4F]" />
            Welcome back to {APP_NAME}
          </div>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">
            Log in to your account
          </h1>
          <p className="mt-1.5 text-xs text-gray-500 sm:text-sm">
            Access verified Nigerian artisans or manage incoming job requests.
          </p>
        </div>

        <LoginForm
          firebaseConfigured={firebaseConfigured}
          supabaseConfigured={supabaseConfigured}
        />

        {/* Trust Badges Footer */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-[11px] font-medium text-gray-500">
          <span className="flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5 text-[#0B6E4F]" />
            Identity Verified
          </span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <Lock className="h-3.5 w-3.5 text-[#0B6E4F]" />
            Paystack Escrow
          </span>
          <span>•</span>
          <span>NDPA 2023 Compliant</span>
        </div>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-gray-400">
          By signing in, you agree to our{" "}
          <Link href="/terms" className="underline hover:text-gray-600">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline hover:text-gray-600">
            Privacy Policy
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
