import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  fetchFirestoreUserProfile,
  getActiveFirebaseSession,
  isFirebaseServerConfigured,
  saveFirestoreUserProfile,
  setFirebaseSessionCookies,
} from "@/lib/firebase/server";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const pauseSchema = z.object({
  paused: z.boolean(),
});

export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);
  const parsed = pauseSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid pause request." }, { status: 400 });
  }

  // 1. Firebase Auth + Firestore Pause/Resume
  if (!isRealSupabaseConfigured() && isFirebaseServerConfigured()) {
    const fbSession = await getActiveFirebaseSession();
    if (!fbSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (fbSession.role !== "artisan") {
      return NextResponse.json(
        { error: "Only artisan accounts can pause search visibility." },
        { status: 403 },
      );
    }

    const nextStatus = parsed.data.paused ? "paused" : "active";
    if (fbSession.idToken) {
      const existing = await fetchFirestoreUserProfile(fbSession.uid, fbSession.idToken);
      if (existing) {
        await saveFirestoreUserProfile(
          fbSession.uid,
          fbSession.idToken,
          { accountStatus: nextStatus, updatedAt: new Date().toISOString() },
          ["accountStatus", "updatedAt"],
        );
      }
    }

    await setFirebaseSessionCookies(
      {
        uid: fbSession.uid,
        email: fbSession.email,
        displayName: fbSession.displayName,
        role: fbSession.role,
        trade: fbSession.trade,
        phone: fbSession.phone,
        accountStatus: nextStatus,
        verificationStatus: fbSession.verificationStatus,
      },
      fbSession.idToken,
    );

    return NextResponse.json({ ok: true, accountStatus: nextStatus });
  }

  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Service not configured." }, { status: 503 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: status, error } = await supabase.rpc("set_artisan_account_pause", {
    p_paused: parsed.data.paused,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not update account pause state." },
      { status: error.code === "42501" ? 403 : 400 },
    );
  }

  return NextResponse.json({ ok: true, accountStatus: status });
}
