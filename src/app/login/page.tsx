import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { LoginForm } from "@/components/LoginForm";
import { APP_NAME } from "@/lib/constants";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage() {
  const configured = isSupabaseServerConfigured();

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
    <div className="flex min-h-dvh flex-col">
      <Header />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">
            Sign in to {APP_NAME}
          </h1>
          <p className="mt-1.5 text-sm text-gray-600">
            Enter your Nigerian phone number to receive a one-time SMS code.
          </p>
        </div>

        <LoginForm supabaseConfigured={configured} />

        <p className="mt-5 text-center text-xs leading-relaxed text-gray-500">
          By continuing, you&apos;ll be asked to confirm you are 18+ and accept our{" "}
          <Link href="/terms" className="underline hover:text-gray-800">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline hover:text-gray-800">
            Privacy Policy
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
