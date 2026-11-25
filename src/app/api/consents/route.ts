import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LEGAL_VERSIONS, type ConsentRecord, type ConsentType } from "@/lib/constants";
import {
  fetchFirestoreUserProfile,
  getActiveFirebaseSession,
  isFirebaseServerConfigured,
  saveFirestoreUserProfile,
} from "@/lib/firebase/server";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const updateConsentSchema = z.object({
  consentType: z.enum(["location", "notifications", "face_matching"]),
  granted: z.boolean(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

function buildFirestoreConsentRows(
  userId: string,
  consentsMap: Record<string, boolean | undefined>,
  fallbackTs: string,
): ConsentRecord[] {
  const orderedTypes: ConsentType[] = [
    "age_18_plus",
    "terms_of_service",
    "privacy_policy",
    "location",
    "notifications",
    "face_matching",
  ];

  const rows: ConsentRecord[] = [];
  for (const type of orderedTypes) {
    const val = consentsMap[type];
    if (typeof val !== "boolean") continue;
    rows.push({
      id: `fb-${userId}-${type}`,
      user_id: userId,
      consent_type: type,
      version: LEGAL_VERSIONS[type],
      granted: val,
      consented_at: fallbackTs,
      withdrawn_at: val ? null : fallbackTs,
      created_at: fallbackTs,
    });
  }
  return rows;
}

export async function GET() {
  if (!isRealSupabaseConfigured() && isFirebaseServerConfigured()) {
    const fbSession = await getActiveFirebaseSession();
    if (!fbSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!fbSession.idToken) {
      return NextResponse.json({ consents: [] });
    }
    const profile = await fetchFirestoreUserProfile(fbSession.uid, fbSession.idToken);
    const consents = profile
      ? buildFirestoreConsentRows(
          fbSession.uid,
          profile.consents ?? {},
          profile.updatedAt || profile.createdAt,
        )
      : [];
    return NextResponse.json({ consents });
  }

  if (!isSupabaseServerConfigured()) {
    return NextResponse.json(
      { error: "Backend is not configured yet." },
      { status: 503 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("consents")
    .select("id, consent_type, version, granted, consented_at, withdrawn_at, created_at")
    .eq("user_id", user.id)
    .order("consented_at", { ascending: false });

  if (error) {
    logger.warn("consents.list_failed", { userId: user.id, code: error.code });
    return NextResponse.json(
      { error: "Could not load your consents." },
      { status: 500 },
    );
  }

  return NextResponse.json({ consents: data ?? [] });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null);
    const parsed = updateConsentSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid consent request." },
        { status: 400 },
      );
    }

    if (!isRealSupabaseConfigured() && isFirebaseServerConfigured()) {
      const fbSession = await getActiveFirebaseSession();
      if (!fbSession) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const nowIso = new Date().toISOString();
      if (fbSession.idToken) {
        const existing = await fetchFirestoreUserProfile(fbSession.uid, fbSession.idToken);
        if (existing) {
          const updatedConsents = {
            ...(existing.consents ?? {}),
            [parsed.data.consentType]: parsed.data.granted,
          };
          await saveFirestoreUserProfile(
            fbSession.uid,
            fbSession.idToken,
            { consents: updatedConsents, updatedAt: nowIso },
            ["consents", "updatedAt"],
          );
        }
      }

      logger.info("consents.updated", {
        userId: fbSession.uid,
        consentType: parsed.data.consentType,
        granted: parsed.data.granted,
      });

      return NextResponse.json({
        ok: true,
        consent: {
          consent_type: parsed.data.consentType,
          granted: parsed.data.granted,
          version: LEGAL_VERSIONS[parsed.data.consentType],
          consented_at: nowIso,
          withdrawn_at: parsed.data.granted ? null : nowIso,
        },
      });
    }

    if (!isSupabaseServerConfigured()) {
      return NextResponse.json(
        { error: "Backend is not configured yet." },
        { status: 503 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const version = LEGAL_VERSIONS[parsed.data.consentType];
    const headerKey = request.headers.get("x-idempotency-key")?.trim();
    const idempotencyKey = parsed.data.idempotencyKey ?? headerKey ?? null;

    const { data, error } = await supabase.rpc("set_optional_consent", {
      p_consent_type: parsed.data.consentType,
      p_granted: parsed.data.granted,
      p_version: version,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      logger.warn("consents.update_failed", {
        userId: user.id,
        consentType: parsed.data.consentType,
        code: error.code,
      });
      return NextResponse.json(
        { error: error.message || "Could not update consent." },
        { status: error.code === "42501" ? 403 : 400 },
      );
    }

    logger.info("consents.updated", {
      userId: user.id,
      consentType: parsed.data.consentType,
      granted: parsed.data.granted,
    });

    return NextResponse.json({ ok: true, consent: data });
  } catch (err) {
    logger.error("consents.exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Something went wrong updating consent." },
      { status: 500 },
    );
  }
}
