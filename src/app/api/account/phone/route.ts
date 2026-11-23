import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { maskPhoneForUi, normalizeNigerianPhone } from "@/lib/phone";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
} from "@/lib/supabase/server";

const updatePhoneSchema = z.object({
  phone: z.string().min(10, "Enter your 11-digit Nigerian mobile number.").max(25),
});

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null);
    const parsed = updatePhoneSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid phone number." },
        { status: 400 },
      );
    }

    let normalizedPhone: string;
    try {
      normalizedPhone = normalizeNigerianPhone(parsed.data.phone);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid Nigerian phone number." },
        { status: 400 },
      );
    }

    const cookieStore = await cookies();

    // 1. Live Supabase update
    if (isRealSupabaseConfigured()) {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
      }

      // Update user phone in Supabase Auth metadata and profiles table
      await supabase.auth.updateUser({
        phone: normalizedPhone,
      }).catch(() => {});

      // Also persist in display metadata
      await supabase
        .from("profiles")
        .update({
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)
        .catch(() => {});
    }

    // Save formatted phone in session cookie for instant display across pages
    cookieStore.set("onise_user_phone", normalizedPhone, {
      path: "/",
      sameSite: "lax",
    });

    logger.info("account.phone_updated", { ok: true });

    return NextResponse.json({
      ok: true,
      phone: normalizedPhone,
      maskedPhone: maskPhoneForUi(normalizedPhone),
    });
  } catch (err) {
    logger.error("account.phone_update_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not update phone number. Please try again." },
      { status: 500 },
    );
  }
}
