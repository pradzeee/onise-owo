import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LEGAL_VERSIONS, TRADES, type ArtisanTrade } from "@/lib/constants";
import { generateGuarantorToken } from "@/lib/guarantor";
import { logger } from "@/lib/logger";
import {
  hashNinForIdentity,
  hashPhoneForIdentity,
  validateNinFormat,
  verifyNinWithFaceAndLiveness,
} from "@/lib/nin";
import { createPaystackPayoutRecipient, validateNubanAccount } from "@/lib/paystack";
import { normalizeNigerianPhone } from "@/lib/phone";
import { checkRateLimit, OTP_RATE_LIMITS } from "@/lib/rate-limit";
import { sendNigerianSms } from "@/lib/sms";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_SELFIE_BYTES = 4 * 1024 * 1024; // 4 MB

const VALID_TRADE_IDS = TRADES.map((t) => t.id) as [ArtisanTrade, ...ArtisanTrade[]];

const artisanTextFieldsSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
  trade: z.enum(VALID_TRADE_IDS, {
    errorMap: () => ({ message: "Select a valid trade." }),
  }),
  bio: z
    .string()
    .trim()
    .min(10, "Write a short bio (at least 10 characters).")
    .max(500, "Bio must be 500 characters or fewer."),
  workArea: z.string().trim().min(2, "Enter your primary work area.").max(120),
  nin: z.string().trim().min(11, "NIN must be 11 digits.").max(20),
  guarantorName: z.string().trim().min(2, "Enter your guarantor's full name.").max(120),
  guarantorPhone: z.string().trim().min(10, "Enter your guarantor's phone number.").max(25),
  bankCode: z.string().trim().min(3, "Select your bank.").max(10),
  accountNumber: z.string().trim().min(10, "Account number must be 10 digits.").max(15),
  faceMatchingConsentAccepted: z.literal("true", {
    errorMap: () => ({
      message:
        "You must grant explicit face matching consent before NIN verification.",
    }),
  }),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

function extensionFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseServerConfigured() || !isSupabaseAdminConfigured()) {
      return NextResponse.json(
        {
          error:
            "Supabase credentials (including SUPABASE_SERVICE_ROLE_KEY) are not configured yet.",
        },
        { status: 503 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
    }

    // Verify caller is an active artisan
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, account_status, verification_status")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile || profile.role !== "artisan") {
      return NextResponse.json(
        { error: "Only artisan accounts can submit artisan verification." },
        { status: 403 },
      );
    }

    if (profile.account_status !== "active") {
      return NextResponse.json(
        { error: "Your account is not active." },
        { status: 403 },
      );
    }

    if (profile.verification_status === "approved") {
      return NextResponse.json(
        { error: "Your artisan account is already approved." },
        { status: 409 },
      );
    }

    const limit = await checkRateLimit(user.id, OTP_RATE_LIMITS.artisanSubmitByUser);
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: `Please wait ${limit.retryAfterSeconds} seconds before submitting again.`,
        },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    const formData = await request.formData();
    const textInput = {
      fullName: String(formData.get("fullName") ?? ""),
      trade: String(formData.get("trade") ?? ""),
      bio: String(formData.get("bio") ?? ""),
      workArea: String(formData.get("workArea") ?? ""),
      nin: String(formData.get("nin") ?? ""),
      guarantorName: String(formData.get("guarantorName") ?? ""),
      guarantorPhone: String(formData.get("guarantorPhone") ?? ""),
      bankCode: String(formData.get("bankCode") ?? ""),
      accountNumber: String(formData.get("accountNumber") ?? ""),
      faceMatchingConsentAccepted: String(
        formData.get("faceMatchingConsentAccepted") ?? "",
      ),
      idempotencyKey:
        String(formData.get("idempotencyKey") ?? "").trim() ||
        request.headers.get("x-idempotency-key")?.trim() ||
        undefined,
    };

    const parsed = artisanTextFieldsSchema.safeParse(textInput);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Check your form fields." },
        { status: 400 },
      );
    }

    // Validate NIN, Nigerian guarantor phone, and NUBAN account on server
    let cleanNin: string;
    let guarantorPhoneE164: string;
    try {
      cleanNin = validateNinFormat(parsed.data.nin);
      guarantorPhoneE164 = normalizeNigerianPhone(parsed.data.guarantorPhone);
      validateNubanAccount(parsed.data.accountNumber, parsed.data.bankCode);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid input format." },
        { status: 400 },
      );
    }

    // Ensure guarantor phone is not the artisan's own phone
    if (user.phone) {
      try {
        const artisanPhoneE164 = normalizeNigerianPhone(user.phone);
        if (artisanPhoneE164 === guarantorPhoneE164) {
          return NextResponse.json(
            { error: "Your guarantor must be a different person with a different phone number." },
            { status: 400 },
          );
        }
      } catch {
        // Ignore if test user signed up without standard NG phone
      }
    }

    // Validate uploaded files
    const profilePhoto = formData.get("profilePhoto");
    const selfie = formData.get("selfie");

    if (!(profilePhoto instanceof File) || profilePhoto.size === 0) {
      return NextResponse.json(
        { error: "Please upload your profile photo." },
        { status: 400 },
      );
    }
    if (!ALLOWED_IMAGE_TYPES.has(profilePhoto.type)) {
      return NextResponse.json(
        { error: "Profile photo must be a JPEG, PNG, or WebP image." },
        { status: 400 },
      );
    }
    if (profilePhoto.size > MAX_PROFILE_PHOTO_BYTES) {
      return NextResponse.json(
        { error: "Profile photo must be 2 MB or smaller." },
        { status: 400 },
      );
    }

    if (!(selfie instanceof File) || selfie.size === 0) {
      return NextResponse.json(
        { error: "Please capture or upload a live selfie for verification." },
        { status: 400 },
      );
    }
    if (!ALLOWED_IMAGE_TYPES.has(selfie.type)) {
      return NextResponse.json(
        { error: "Selfie must be a JPEG, PNG, or WebP image." },
        { status: 400 },
      );
    }
    if (selfie.size > MAX_SELFIE_BYTES) {
      return NextResponse.json(
        { error: "Selfie must be 4 MB or smaller." },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();

    // Idempotency check: if already processed with this exact idempotencyKey, return cleanly
    if (parsed.data.idempotencyKey) {
      const { data: existingVerif } = await admin
        .from("artisan_verifications")
        .select("id, provider_status, liveness_passed, face_match_passed, provider_reference")
        .eq("user_id", user.id)
        .eq("idempotency_key", parsed.data.idempotencyKey)
        .maybeSingle();

      if (existingVerif) {
        return NextResponse.json({
          ok: true,
          idempotentReplay: true,
          verification: existingVerif,
        });
      }
    }

    // 1. Record explicit face_matching consent BEFORE calling verification provider
    const { data: consentRow, error: consentErr } = await supabase.rpc(
      "set_optional_consent",
      {
        p_consent_type: "face_matching",
        p_granted: true,
        p_version: LEGAL_VERSIONS.face_matching,
        p_idempotency_key: parsed.data.idempotencyKey
          ? `${parsed.data.idempotencyKey}:face`
          : null,
      },
    );

    if (consentErr || !consentRow?.id) {
      logger.warn("artisan.face_consent_failed", {
        userId: user.id,
        code: consentErr?.code,
      });
      return NextResponse.json(
        { error: "Could not save your face matching consent. Please try again." },
        { status: 400 },
      );
    }

    // 2. Check NIN duplicate prevention via keyed HMAC hash BEFORE calling provider
    const ninHash = hashNinForIdentity(cleanNin);
    const { data: conflictingNin } = await admin
      .from("identity_hashes")
      .select("user_id")
      .eq("hash_type", "nin")
      .eq("hash_value", ninHash)
      .maybeSingle();

    if (conflictingNin && conflictingNin.user_id !== user.id) {
      return NextResponse.json(
        {
          error:
            "This NIN is already linked to another Oníṣẹ́ ọwọ́ account and cannot be reused.",
        },
        { status: 409 },
      );
    }

    // 3. Upload profile photo (public bucket) & selfie (PRIVATE bucket)
    const photoBuffer = Buffer.from(await profilePhoto.arrayBuffer());
    const selfieBuffer = Buffer.from(await selfie.arrayBuffer());

    const photoPath = `${user.id}/profile.${extensionFromMime(profilePhoto.type)}`;
    const selfiePath = `${user.id}/selfie-${Date.now()}.${extensionFromMime(selfie.type)}`;

    const { error: photoUploadErr } = await admin.storage
      .from("artisan-photos")
      .upload(photoPath, photoBuffer, {
        contentType: profilePhoto.type,
        upsert: true,
      });

    if (photoUploadErr) {
      logger.error("artisan.photo_upload_failed", { userId: user.id });
      return NextResponse.json(
        { error: "Could not upload your profile photo. Please try again." },
        { status: 500 },
      );
    }

    const { error: selfieUploadErr } = await admin.storage
      .from("artisan-verifications")
      .upload(selfiePath, selfieBuffer, {
        contentType: selfie.type,
        upsert: false,
      });

    if (selfieUploadErr) {
      logger.error("artisan.selfie_upload_failed", { userId: user.id });
      return NextResponse.json(
        { error: "Could not securely store your verification selfie. Please try again." },
        { status: 500 },
      );
    }

    // 4. Register payout recipient with Paystack (store ONLY recipient_code, NEVER bank details)
    let payout: { recipientCode: string; subaccountCode: string | null };
    try {
      payout = await createPaystackPayoutRecipient({
        fullName: parsed.data.fullName,
        accountNumber: parsed.data.accountNumber,
        bankCode: parsed.data.bankCode,
        artisanUserId: user.id,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Could not register your bank account for payouts.",
        },
        { status: 400 },
      );
    }

    // 5. Send NIN + selfie ONLY to verification provider (face match + liveness)
    // Raw NIN is NEVER written to Postgres or logs.
    let providerResult;
    try {
      providerResult = await verifyNinWithFaceAndLiveness({
        nin: cleanNin,
        selfieBase64: selfieBuffer.toString("base64"),
        idempotencyKey: parsed.data.idempotencyKey,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Identity verification provider failed. Please try again.",
        },
        { status: 502 },
      );
    }

    // 6. Store keyed HMAC hashes in identity_hashes (NIN + phone)
    const { error: ninHashErr } = await admin.from("identity_hashes").upsert(
      {
        user_id: user.id,
        hash_type: "nin",
        hash_value: ninHash,
      },
      { onConflict: "user_id,hash_type" },
    );

    if (ninHashErr) {
      if (ninHashErr.code === "23505") {
        return NextResponse.json(
          { error: "This NIN is already registered on another account." },
          { status: 409 },
        );
      }
      logger.error("artisan.identity_hash_failed", {
        userId: user.id,
        code: ninHashErr.code,
      });
      return NextResponse.json(
        { error: "Could not save identity verification hash." },
        { status: 500 },
      );
    }

    if (user.phone) {
      try {
        const phoneHash = hashPhoneForIdentity(normalizeNigerianPhone(user.phone));
        await admin.from("identity_hashes").upsert(
          {
            user_id: user.id,
            hash_type: "phone",
            hash_value: phoneHash,
          },
          { onConflict: "user_id,hash_type" },
        );
      } catch {
        // Non-Nigerian test phone; skip phone hash cleanly
      }
    }

    // 7. Save artisan profile (ONLY payout recipient code, NEVER bank details; status = pending)
    const nowUtc = new Date().toISOString();
    const { error: artisanUpsertErr } = await admin.from("artisan_profiles").upsert(
      {
        user_id: user.id,
        full_name: parsed.data.fullName,
        photo_path: photoPath,
        trade: parsed.data.trade,
        bio: parsed.data.bio,
        work_area: parsed.data.workArea,
        payout_recipient_code: payout.recipientCode,
        payout_subaccount_code: payout.subaccountCode,
        verification_status: "pending",
        rejection_reason: null,
        is_online: false,
        updated_at: nowUtc,
      },
      { onConflict: "user_id" },
    );

    if (artisanUpsertErr) {
      logger.error("artisan.profile_upsert_failed", {
        userId: user.id,
        code: artisanUpsertErr.code,
      });
      return NextResponse.json(
        { error: "Could not save artisan profile." },
        { status: 500 },
      );
    }

    // Sync public.profiles display_name + pending status
    await admin
      .from("profiles")
      .update({
        display_name: parsed.data.fullName,
        verification_status: "pending",
        updated_at: nowUtc,
      })
      .eq("id", user.id);

    // 8. Save provider verification result (ONLY reference, status, liveness/face match, private selfie path)
    const { error: verifUpsertErr } = await admin
      .from("artisan_verifications")
      .upsert(
        {
          user_id: user.id,
          provider_name: providerResult.providerName,
          provider_reference: providerResult.providerReference,
          provider_status: providerResult.providerStatus,
          liveness_passed: providerResult.livenessPassed,
          face_match_passed: providerResult.faceMatchPassed,
          selfie_storage_path: selfiePath,
          face_matching_consent_id: consentRow.id,
          idempotency_key: parsed.data.idempotencyKey ?? null,
          checked_at: nowUtc,
          updated_at: nowUtc,
        },
        { onConflict: "user_id" },
      );

    if (verifUpsertErr) {
      logger.error("artisan.verification_upsert_failed", {
        userId: user.id,
        code: verifUpsertErr.code,
      });
      return NextResponse.json(
        { error: "Could not record verification result." },
        { status: 500 },
      );
    }

    // 9. Create guarantor verification record & send SMS with confirmation link
    const { rawToken, tokenHash } = generateGuarantorToken();
    const guarantorPhoneHash = hashPhoneForIdentity(guarantorPhoneE164);

    const { error: guarantorErr } = await admin
      .from("guarantor_verifications")
      .upsert(
        {
          artisan_id: user.id,
          guarantor_name: parsed.data.guarantorName,
          guarantor_phone_hash: guarantorPhoneHash,
          guarantor_phone_e164: guarantorPhoneE164,
          token_hash: tokenHash,
          otp_hash: null,
          otp_expires_at: null,
          otp_attempts: 0,
          status: "pending",
          confirmed_at: null,
          sms_sent_at: nowUtc,
          updated_at: nowUtc,
        },
        { onConflict: "artisan_id" },
      );

    if (guarantorErr) {
      logger.error("artisan.guarantor_upsert_failed", {
        userId: user.id,
        code: guarantorErr.code,
      });
      return NextResponse.json(
        { error: "Could not initiate guarantor confirmation." },
        { status: 500 },
      );
    }

    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin
    ).replace(/\/$/, "");
    const guarantorLink = `${appUrl}/guarantor/${rawToken}`;

    const smsResult = await sendNigerianSms({
      toE164: guarantorPhoneE164,
      purpose: "guarantor_invite",
      message: `${parsed.data.fullName} listed you as a guarantor on Onise Owo. Open this link to review our privacy notice and confirm with a one-time code: ${guarantorLink}`,
    });

    logger.info("artisan.onboarding_submitted", {
      userId: user.id,
      providerStatus: providerResult.providerStatus,
      smsProvider: smsResult.provider,
    });

    const isDevMockSms =
      process.env.NODE_ENV !== "production" && smsResult.provider === "dev_mock";

    return NextResponse.json({
      ok: true,
      verification: {
        providerStatus: providerResult.providerStatus,
        livenessPassed: providerResult.livenessPassed,
        faceMatchPassed: providerResult.faceMatchPassed,
        providerReference: providerResult.providerReference,
      },
      guarantorStatus: "pending",
      ...(isDevMockSms ? { devGuarantorLink: guarantorLink } : {}),
    });
  } catch (err) {
    logger.error("artisan.onboarding_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Something went wrong submitting your verification. Please try again." },
      { status: 500 },
    );
  }
}
