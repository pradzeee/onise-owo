import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { SignupForm } from "@/components/SignupForm";
import { APP_NAME } from "@/lib/constants";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create an Account",
};

export default async function SignupPage() {
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
    <div className="flex min-h-dvh flex-col bg-gray-50/50">
      <Header />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8 sm:py-12">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
            Join {APP_NAME}
          </h1>
          <p className="mt-1.5 text-sm text-gray-600">
            Sign up as a customer or artisan to get started.
          </p>
        </div>

        <SignupForm supabaseConfigured={configured} />
      </main>
    </div>
  );
}
