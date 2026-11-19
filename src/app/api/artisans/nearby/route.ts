import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { TRADES, type ArtisanTrade, type NearbyArtisanResult } from "@/lib/constants";
import { getMockNearbyArtisans, isDevAccessAllowed } from "@/lib/dev-access";
import { DISCOVERY_RADIUS_METERS, validateCoordinates } from "@/lib/location";
import { logger } from "@/lib/logger";
import {
  createSupabaseServerClient,
  isRealSupabaseConfigured,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const VALID_TRADES = TRADES.map((t) => t.id) as [ArtisanTrade, ...ArtisanTrade[]];

const querySchema = z.object({
  trade: z.enum(VALID_TRADES),
  lat: z.coerce.number().finite().min(-90).max(90),
  lng: z.coerce.number().finite().min(-180).max(180),
  radius: z.coerce
    .number()
    .int()
    .min(500)
    .max(DISCOVERY_RADIUS_METERS)
    .default(DISCOVERY_RADIUS_METERS),
});

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const parsed = querySchema.safeParse({
      trade: sp.get("trade"),
      lat: sp.get("lat"),
      lng: sp.get("lng"),
      radius: sp.get("radius") ?? DISCOVERY_RADIUS_METERS,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid search parameters." },
        { status: 400 },
      );
    }

    // In dev access mode without live Supabase, return rich mock artisans around search coordinates
    if (isDevAccessAllowed() && !isRealSupabaseConfigured()) {
      const rounded = validateCoordinates(parsed.data.lat, parsed.data.lng);
      const artisans = getMockNearbyArtisans(parsed.data.trade, rounded.lat, rounded.lng);
      return NextResponse.json({
        ok: true,
        searchCenter: rounded,
        radiusMeters: parsed.data.radius,
        artisans,
      });
    }

    if (!isSupabaseServerConfigured()) {
      return NextResponse.json(
        { error: "Supabase is not configured." },
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

    const rounded = validateCoordinates(parsed.data.lat, parsed.data.lng);

    const { data, error } = await supabase.rpc("find_nearby_artisans", {
      p_trade: parsed.data.trade,
      p_lat: rounded.lat,
      p_lng: rounded.lng,
      p_radius_meters: parsed.data.radius,
      p_limit: 30,
    });

    if (error) {
      logger.warn("discovery.nearby_failed", {
        userId: user.id,
        trade: parsed.data.trade,
        code: error.code,
      });
      return NextResponse.json(
        { error: error.message || "Could not search nearby artisans." },
        { status: 400 },
      );
    }

    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");

    // Explicitly project ONLY safe discovery fields — NEVER phone numbers or exact addresses
    const artisans: NearbyArtisanResult[] = (
      (data ?? []) as Omit<NearbyArtisanResult, "photo_url">[]
    ).map((row) => ({
      artisan_id: row.artisan_id,
      full_name: row.full_name,
      photo_path: row.photo_path,
      photo_url:
        row.photo_path && supabaseUrl
          ? `${supabaseUrl}/storage/v1/object/public/artisan-photos/${row.photo_path}`
          : null,
      trade: row.trade,
      work_area: row.work_area,
      rating_avg: Number(row.rating_avg ?? 0),
      rating_count: Number(row.rating_count ?? 0),
      distance_meters: Number(row.distance_meters ?? 0),
      approx_lat: Number(row.approx_lat),
      approx_lng: Number(row.approx_lng),
      last_seen_at: row.last_seen_at,
    }));

    return NextResponse.json({
      ok: true,
      searchCenter: rounded,
      radiusMeters: parsed.data.radius,
      artisans,
    });
  } catch (err) {
    logger.error("discovery.nearby_exception", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not search nearby artisans right now." },
      { status: 500 },
    );
  }
}
