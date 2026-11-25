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

/**
 * Resolves the canonical public origin for generated links (Paystack callbacks,
 * safety share URLs, guarantor confirmations). If `NEXT_PUBLIC_APP_URL` contains
 * localhost inside a Vercel deployment, falls back cleanly to the live origin.
 */
export function resolveAppBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const isVercelDeployment = process.env.VERCEL === "1";

  if (
    configured &&
    !(isVercelDeployment && /localhost|127\.0\.0\.1/i.test(configured))
  ) {
    return configured.replace(/\/$/, "");
  }

  const requestOrigin = request.nextUrl.origin;
  if (requestOrigin && !/localhost|127\.0\.0\.1/i.test(requestOrigin)) {
    return requestOrigin.replace(/\/$/, "");
  }

  const vercelProdUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProdUrl) {
    return `https://${vercelProdUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  }

  return (configured || requestOrigin || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}
