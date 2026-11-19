import type { NextRequest } from "next/server";

/**
 * Extracts best-effort client IP from reverse proxy headers (Vercel/Cloudflare/NGINX).
 * Always HMAC-hashed before storing in rate limits; never logged raw.
 */
export function getClientIp(request: NextRequest): string {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "unknown";
}
