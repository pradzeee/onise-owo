import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { dispatchAlertWithSmsFallback } from "@/lib/alerts";
import { TRADES, type ArtisanTrade } from "@/lib/constants";
import { processDueJobDispatchRounds } from "@/lib/dispatch";
import { stripExifAndCompressJobPhoto } from "@/lib/image";
import { DISPATCH_ROUND_SECONDS, MAX_JOB_PHOTOS } from "@/lib/jobs";
import { validateCoordinates } from "@/lib/location";
import { logger } from "@/lib/logger";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_RAW_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB raw before server compression to ~300 KB
const VALID_TRADES = TRADES.map((t) => t.id) as [ArtisanTrade, ...ArtisanTrade[]];

const createJobSchema = z.object({
  trade: z.enum(VALID_TRADES),
  description: z
    .string()
    .trim()
    .min(10, "Describe the job in at least 10 characters.")
    .max(1000, "Description must be 1000 characters or fewer."),
  exactAddress: z
    .string()
    .trim()
    .min(5, "Enter the exact street address for after acceptance.")
    .max(300),
  approxAreaLabel: z
    .string()
    .trim()
    .min(2, "Enter your general area/neighbourhood (e.g. Ikeja, Lagos).")
    .max(120),
  lat: z.coerce.number().finite().min(-90).max(90),
  lng: z.coerce.number().finite().min(-180).max(180),
  dispatchMode: z.enum(["direct", "nearest_3"]),
  targetArtisanId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export async function GET() {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ jobs: [], incomingRequests: [] });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Advance any expired 60s dispatch waves cleanly
  await processDueJobDispatchRounds().catch(() => {});

  const [{ data: jobs }, { data: requests }] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, customer_id, artisan_id, trade, description, approx_area_label, dispatch_mode, dispatch_round, round_expires_at, status, accepted_amount_kobo, cancel_fee_kobo, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("job_requests")
      .select("id, job_id, artisan_id, round_number, status, sent_at, expires_at, responded_at")
      .eq("artisan_id", user.id)
      .order("sent_at", { ascending: false })
      .limit(20),
  ]);

  return NextResponse.json({
    ok: true,
    jobs: jobs ?? [],
    incomingRequests: requests ?? [],
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseServerConfigured() || !isSupabaseAdminConfigured()) {
      return NextResponse.json(
        { error: "Supabase server configuration is incomplete." },
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, account_status")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile || profile.account_status !== "active") {
      return NextResponse.json({ error: "Active account required." }, { status: 403 });
    }

    const formData = await request.formData();
    const rawTarget = String(formData.get("targetArtisanId") ?? "").trim();
    const rawIdem =
      String(formData.get("idempotencyKey") ?? "").trim() ||
      request.headers.get("x-idempotency-key")?.trim() ||
      undefined;

    const parsed = createJobSchema.safeParse({
      trade: String(formData.get("trade") ?? ""),
      description: String(formData.get("description") ?? ""),
      exactAddress: String(formData.get("exactAddress") ?? ""),
      approxAreaLabel: String(formData.get("approxAreaLabel") ?? ""),
      lat: formData.get("lat"),
      lng: formData.get("lng"),
      dispatchMode: String(formData.get("dispatchMode") ?? "nearest_3"),
      targetArtisanId: rawTarget || undefined,
      idempotencyKey: rawIdem,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Check your job request details." },
        { status: 400 },
      );
    }

    if (parsed.data.dispatchMode === "direct" && !parsed.data.targetArtisanId) {
      return NextResponse.json(
        { error: "Select a specific verified artisan for a direct request." },
        { status: 400 },
      );
    }

    if (parsed.data.targetArtisanId === user.id) {
      return NextResponse.json(
        { error: "You cannot send a job request to yourself." },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();

    // Idempotency check
    if (parsed.data.idempotencyKey) {
      const { data: existingJob } = await admin
        .from("jobs")
        .select("id, status, dispatch_round, round_expires_at")
        .eq("customer_id", user.id)
        .eq("idempotency_key", parsed.data.idempotencyKey)
        .maybeSingle();

      if (existingJob) {
        return NextResponse.json({
          ok: true,
          idempotentReplay: true,
          jobId: existingJob.id,
          status: existingJob.status,
        });
      }
    }

    // Validate up to 3 photos
    const rawPhotos = formData
      .getAll("photos")
      .filter((item): item is File => item instanceof File && item.size > 0);

    if (rawPhotos.length > MAX_JOB_PHOTOS) {
      return NextResponse.json(
        { error: `You can upload up to ${MAX_JOB_PHOTOS} photos per job.` },
        { status: 400 },
      );
    }

    for (const photo of rawPhotos) {
      if (!ALLOWED_IMAGE_TYPES.has(photo.type)) {
        return NextResponse.json(
          { error: "Photos must be JPEG, PNG, or WebP images." },
          { status: 400 },
        );
      }
      if (photo.size > MAX_RAW_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: "Each raw photo must be 10 MB or smaller before compression." },
          { status: 400 },
        );
      }
    }

    // Find eligible Round 1 artisans BEFORE creating the job
    const rounded = validateCoordinates(parsed.data.lat, parsed.data.lng);
    let round1ArtisanIds: string[] = [];

    if (parsed.data.dispatchMode === "direct") {
      const { data: target } = await admin
        .from("artisan_profiles")
        .select("user_id, trade, verification_status, is_online, last_seen_at")
        .eq("user_id", parsed.data.targetArtisanId!)
        .maybeSingle();

      const fifteenMinsAgo = Date.now() - 15 * 60 * 1000;
      const isFresh =
        target?.last_seen_at && new Date(target.last_seen_at).getTime() >= fifteenMinsAgo;

      if (
        !target ||
        target.verification_status !== "approved" ||
        !target.is_online ||
        !isFresh
      ) {
        return NextResponse.json(
          {
            error:
              "The selected artisan is currently offline or unavailable. Try sending to the nearest 3 verified artisans instead.",
          },
          { status: 409 },
        );
      }

      round1ArtisanIds = [target.user_id];
    } else {
      const { data: nearby } = await supabase.rpc("find_nearby_artisans", {
        p_trade: parsed.data.trade,
        p_lat: rounded.lat,
        p_lng: rounded.lng,
        p_radius_meters: 10000,
        p_limit: 5,
      });

      round1ArtisanIds = ((nearby ?? []) as { artisan_id: string }[])
        .map((r) => r.artisan_id)
        .filter((aid) => aid !== user.id)
        .slice(0, 3);

      if (round1ArtisanIds.length === 0) {
        return NextResponse.json(
          {
            error:
              "No verified, Online artisans for this trade are within 10 km right now. Please try again shortly.",
          },
          { status: 404 },
        );
      }
    }

    const now = new Date();
    const nowUtc = now.toISOString();
    const roundSeconds =
      parsed.data.dispatchMode === "nearest_3" ? DISPATCH_ROUND_SECONDS : 180;
    const roundExpiresAt = new Date(now.getTime() + roundSeconds * 1000).toISOString();

    // 1. Create job row (approx ~100m point only; exact address stored separately!)
    const { data: createdJob, error: jobErr } = await admin
      .from("jobs")
      .insert({
        customer_id: user.id,
        trade: parsed.data.trade,
        description: parsed.data.description,
        dispatch_mode: parsed.data.dispatchMode,
        dispatch_round: 1,
        round_expires_at: roundExpiresAt,
        approx_location: `SRID=4326;POINT(${rounded.lng} ${rounded.lat})`,
        approx_area_label: parsed.data.approxAreaLabel,
        status: "requested",
        idempotency_key: parsed.data.idempotencyKey ?? null,
        created_at: nowUtc,
        updated_at: nowUtc,
      })
      .select("id")
      .single();

    if (jobErr || !createdJob) {
      logger.error("jobs.create_failed", { userId: user.id, code: jobErr?.code });
      return NextResponse.json(
        { error: "Could not create job request right now." },
        { status: 500 },
      );
    }

    // 2. Store exact customer address in strictly RLS-gated job_private_addresses
    const { error: addrErr } = await admin.from("job_private_addresses").insert({
      job_id: createdJob.id,
      exact_address: parsed.data.exactAddress,
      exact_lat: parsed.data.lat,
      exact_lng: parsed.data.lng,
      created_at: nowUtc,
    });

    if (addrErr) {
      await admin.from("jobs").delete().eq("id", createdJob.id);
      return NextResponse.json(
        { error: "Could not securely store your job address." },
        { status: 500 },
      );
    }

    // 3. Strip EXIF & compress up to 3 photos to <= ~300 KB, upload to private job-photos bucket
    const photoPaths: string[] = [];
    for (let i = 0; i < rawPhotos.length; i += 1) {
      const rawBuf = Buffer.from(await rawPhotos[i].arrayBuffer());
      const processed = await stripExifAndCompressJobPhoto(rawBuf);
      const storagePath = `${createdJob.id}/photo-${i + 1}.jpg`;
      const { error: upErr } = await admin.storage
        .from("job-photos")
        .upload(storagePath, processed.buffer, {
          contentType: processed.contentType,
          upsert: true,
        });
      if (!upErr) {
        photoPaths.push(storagePath);
      }
    }

    if (photoPaths.length > 0) {
      await admin
        .from("jobs")
        .update({ photo_paths: photoPaths })
        .eq("id", createdJob.id);
    }

    // 4. Create Round 1 job_requests rows & notify invited artisans (Web Push + 30s SMS backup)
    await admin.from("job_requests").insert(
      round1ArtisanIds.map((artisanId) => ({
        job_id: createdJob.id,
        artisan_id: artisanId,
        round_number: 1,
        status: "sent",
        sent_at: nowUtc,
        expires_at: roundExpiresAt,
      })),
    );

    await Promise.all(
      round1ArtisanIds.map((artisanId) =>
        dispatchAlertWithSmsFallback({
          userId: artisanId,
          alertType: "job_request",
          title: `New ${parsed.data.trade.replace("_", " ")} request nearby!`,
          body: `Area: ${parsed.data.approxAreaLabel}. Open Oníṣẹ́ ọwọ́ to accept — first to accept wins.`,
          url: `/jobs/${createdJob.id}`,
          referenceId: createdJob.id,
          idempotencyKey: `job_req:${createdJob.id}:r1:${artisanId}`,
        }).catch(() => {}),
      ),
    );

    // Local/long-running Node fast-path timer for 60s wave escalation
    const timer = setTimeout(() => {
      processDueJobDispatchRounds(createdJob.id).catch(() => {});
    }, (roundSeconds + 1) * 1000);
    if (typeof timer.unref === "function") timer.unref();

    logger.info("jobs.created", {
      jobId: createdJob.id,
      trade: parsed.data.trade,
      dispatchMode: parsed.data.dispatchMode,
      invitedCount: round1ArtisanIds.length,
      photoCount: photoPaths.length,
    });

    return NextResponse.json({
      ok: true,
      jobId: createdJob.id,
      invitedCount: round1ArtisanIds.length,
      roundExpiresAt,
    });
  } catch (err) {
    logger.error("jobs.create_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not create job request right now." },
      { status: 500 },
    );
  }
}
