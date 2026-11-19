import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateCoordinates } from "@/lib/location";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const presenceSchema = z.object({
  isOnline: z.boolean(),
  lat: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
});

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseServerConfigured()) {
      return NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 503 },
      );
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = presenceSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid presence payload." },
        { status: 400 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let roundedLat: number | null = null;
    let roundedLng: number | null = null;

    if (parsed.data.lat !== undefined && parsed.data.lng !== undefined) {
      const rounded = validateCoordinates(parsed.data.lat, parsed.data.lng);
      roundedLat = rounded.lat;
      roundedLng = rounded.lng;
    }

    const { data, error } = await supabase.rpc("set_artisan_presence", {
      p_is_online: parsed.data.isOnline,
      p_lat: roundedLat,
      p_lng: roundedLng,
    });

    if (error) {
      logger.warn("artisan.presence_failed", {
        userId: user.id,
        isOnline: parsed.data.isOnline,
        code: error.code,
      });
      return NextResponse.json(
        { error: error.message || "Could not update Online status." },
        { status: error.code === "42501" ? 403 : 400 },
      );
    }

    const row = Array.isArray(data) ? data[0] : data;

    logger.info("artisan.presence_updated", {
      userId: user.id,
      isOnline: parsed.data.isOnline,
    });

    return NextResponse.json({
      ok: true,
      presence: row,
    });
  } catch (err) {
    logger.error("artisan.presence_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not update Online status right now." },
      { status: 500 },
    );
  }
}
