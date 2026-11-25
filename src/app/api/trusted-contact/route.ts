import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  deleteFirestoreTrustedContact,
  fetchFirestoreTrustedContact,
  getActiveFirebaseSession,
  isFirebaseServerConfigured,
  saveFirestoreTrustedContact,
} from "@/lib/firebase/server";
import { maskPhoneForUi, normalizeNigerianPhone } from "@/lib/phone";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const contactSchema = z.object({
  contactName: z.string().trim().min(2, "Enter your trusted contact's name.").max(120),
  contactPhone: z.string().trim().min(10, "Enter a valid Nigerian mobile number.").max(25),
});

export async function GET() {
  if (!isRealSupabaseConfigured() && isFirebaseServerConfigured()) {
    const fbSession = await getActiveFirebaseSession();
    if (!fbSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const contact = fbSession.idToken
      ? await fetchFirestoreTrustedContact(fbSession.uid, fbSession.idToken)
      : null;

    return NextResponse.json({
      contact: contact
        ? {
            contactName: contact.contactName,
            contactPhone: contact.contactPhone,
            maskedPhone: maskPhoneForUi(contact.contactPhone),
            updatedAt: contact.updatedAt,
          }
        : null,
    });
  }

  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ contact: null });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data } = await supabase
    .from("trusted_contacts")
    .select("contact_name, contact_phone_e164, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    contact: data
      ? {
          contactName: data.contact_name,
          contactPhone: data.contact_phone_e164,
          maskedPhone: maskPhoneForUi(data.contact_phone_e164),
          updatedAt: data.updated_at,
        }
      : null,
  });
}

export async function PUT(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);
  const parsed = contactSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid trusted contact." },
      { status: 400 },
    );
  }

  let phoneE164: string;
  try {
    phoneE164 = normalizeNigerianPhone(parsed.data.contactPhone);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid Nigerian phone number." },
      { status: 400 },
    );
  }

  const nowUtc = new Date().toISOString();

  if (!isRealSupabaseConfigured() && isFirebaseServerConfigured()) {
    const fbSession = await getActiveFirebaseSession();
    if (!fbSession || !fbSession.idToken) {
      return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
    }

    const saved = await saveFirestoreTrustedContact(fbSession.uid, fbSession.idToken, {
      contactName: parsed.data.contactName,
      contactPhone: phoneE164,
      updatedAt: nowUtc,
    });

    if (!saved) {
      return NextResponse.json(
        { error: "Could not save trusted contact." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      contact: {
        contactName: parsed.data.contactName,
        contactPhone: phoneE164,
        maskedPhone: maskPhoneForUi(phoneE164),
        updatedAt: nowUtc,
      },
    });
  }

  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Backend not configured." }, { status: 503 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase.from("trusted_contacts").upsert(
    {
      user_id: user.id,
      contact_name: parsed.data.contactName,
      contact_phone_e164: phoneE164,
      updated_at: nowUtc,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    return NextResponse.json(
      { error: "Could not save trusted contact." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    contact: {
      contactName: parsed.data.contactName,
      contactPhone: phoneE164,
      maskedPhone: maskPhoneForUi(phoneE164),
      updatedAt: nowUtc,
    },
  });
}

export async function DELETE() {
  if (!isRealSupabaseConfigured() && isFirebaseServerConfigured()) {
    const fbSession = await getActiveFirebaseSession();
    if (!fbSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (fbSession.idToken) {
      await deleteFirestoreTrustedContact(fbSession.uid, fbSession.idToken);
    }
    return NextResponse.json({ ok: true });
  }

  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ ok: true });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await supabase.from("trusted_contacts").delete().eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
