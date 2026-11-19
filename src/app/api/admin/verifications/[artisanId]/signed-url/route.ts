import { NextResponse, type NextRequest } from "next/server";
import { checkAdminTwoStep } from "@/lib/admin-auth";
import { logger } from "@/lib/logger";
import { checkRateLimit, OTP_RATE_LIMITS } from "@/lib/rate-limit";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const SIGNED_URL_EXPIRY_SECONDS = 60;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Issues a 60-second signed URL for an artisan's private verification selfie.
 * STRICT RULES:
 * - Caller must be an active admin.
 * - Every file open is written to audit_log BEFORE returning the signed URL.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ artisanId: string }> },
) {
  try {
    if (!isSupabaseServerConfigured() || !isSupabaseAdminConfigured()) {
      return NextResponse.json(
        { error: "Supabase server configuration is incomplete." },
        { status: 503 },
      );
    }

    const { artisanId } = await context.params;
    if (!UUID_REGEX.test(artisanId)) {
      return NextResponse.json({ error: "Invalid artisan ID." }, { status: 400 });
    }

    const check = await checkAdminTwoStep();
    if (!check.authenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!check.isAdmin || !check.mfaVerified) {
      return NextResponse.json(
        { error: "Admin two-step verification required.", mfaRequired: check.isAdmin },
        { status: 403 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role, account_status")
      .eq("id", user.id)
      .maybeSingle();

    if (
      !callerProfile ||
      callerProfile.role !== "admin" ||
      callerProfile.account_status !== "active"
    ) {
      return NextResponse.json({ error: "Admin privileges required." }, { status: 403 });
    }

    const limit = await checkRateLimit(user.id, OTP_RATE_LIMITS.adminSignedUrlByAdmin);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${limit.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    const admin = createSupabaseAdminClient();
    const { data: verification, error: verifErr } = await admin
      .from("artisan_verifications")
      .select("selfie_storage_path")
      .eq("user_id", artisanId)
      .maybeSingle();

    if (verifErr || !verification?.selfie_storage_path) {
      return NextResponse.json(
        { error: "No private verification selfie found for this artisan." },
        { status: 404 },
      );
    }

    // Write file open to audit_log via authenticated admin RPC BEFORE creating signed URL
    const { data: auditLogId, error: auditErr } = await supabase.rpc(
      "log_admin_file_access",
      {
        p_artisan_id: artisanId,
        p_storage_path: verification.selfie_storage_path,
        p_expires_in_seconds: SIGNED_URL_EXPIRY_SECONDS,
      },
    );

    if (auditErr) {
      logger.error("admin.file_audit_failed", {
        adminId: user.id,
        artisanId,
        code: auditErr.code,
      });
      return NextResponse.json(
        { error: "Could not write audit log entry. File access denied." },
        { status: 500 },
      );
    }

    const { data: signed, error: signErr } = await admin.storage
      .from("artisan-verifications")
      .createSignedUrl(verification.selfie_storage_path, SIGNED_URL_EXPIRY_SECONDS);

    if (signErr || !signed?.signedUrl) {
      logger.error("admin.signed_url_failed", { adminId: user.id, artisanId });
      return NextResponse.json(
        { error: "Could not generate 60-second signed link." },
        { status: 500 },
      );
    }

    logger.info("admin.verification_file_opened", {
      adminId: user.id,
      artisanId,
      auditLogId,
    });

    return NextResponse.json({
      ok: true,
      signedUrl: signed.signedUrl,
      expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS,
      auditLogId,
    });
  } catch (err) {
    logger.error("admin.signed_url_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not open verification file." },
      { status: 500 },
    );
  }
}
