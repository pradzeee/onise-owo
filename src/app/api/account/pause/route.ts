import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const pauseSchema = z.object({
  paused: z.boolean(),
});

export async function POST(request: NextRequest) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = pauseSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid pause request." }, { status: 400 });
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
