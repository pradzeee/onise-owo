import { NextResponse, type NextRequest } from "next/server";
import { runDailyPaymentReconciliation } from "@/lib/reconciliation";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

async function isAuthorizedCronOrAdmin(request: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (secret && authHeader === `Bearer ${secret}`) {
    return true;
  }

  if (isSupabaseServerConfigured()) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, account_status")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.role === "admin" && profile.account_status === "active") {
        return true;
      }
    }
  }

  return !secret && process.env.NODE_ENV !== "production";
}

/**
 * Daily reconciliation report comparing our paid payment records with Paystack.
 * Callable by scheduled cron (CRON_SECRET) or an authenticated admin.
 */
export async function POST(request: NextRequest) {
  const allowed = await isAuthorizedCronOrAdmin(request);
  if (!allowed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { reportDate?: string };
    const summary = await runDailyPaymentReconciliation(body.reportDate);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not run payment reconciliation.",
      },
      { status: 500 },
    );
  }
}
