import { hmacHash } from "./crypto";
import { logger } from "./logger";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "./supabase/admin";

export interface RateLimitPolicy {
  scope: string;
  maxRequests: number;
  windowSeconds: number;
  cooldownSeconds?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface MemoryBucket {
  windowStartedAtMs: number;
  requestCount: number;
  lastRequestAtMs: number;
}

// Used ONLY for unit tests or local dev when SUPABASE_SERVICE_ROLE_KEY is not yet configured
const memoryBuckets = new Map<string, MemoryBucket>();

export function resetInMemoryRateLimits(): void {
  memoryBuckets.clear();
}

export function consumeInMemoryRateLimit(
  keyHash: string,
  maxRequests: number,
  windowSeconds: number,
  cooldownSeconds = 0,
  nowMs = Date.now(),
): RateLimitResult {
  const existing = memoryBuckets.get(keyHash);
  if (!existing) {
    memoryBuckets.set(keyHash, {
      windowStartedAtMs: nowMs,
      requestCount: 1,
      lastRequestAtMs: nowMs,
    });
    return {
      allowed: true,
      remaining: Math.max(maxRequests - 1, 0),
      retryAfterSeconds: 0,
    };
  }

  const elapsedWindowSec = (nowMs - existing.windowStartedAtMs) / 1000;
  const elapsedSinceLastSec = (nowMs - existing.lastRequestAtMs) / 1000;

  if (cooldownSeconds > 0 && elapsedSinceLastSec < cooldownSeconds) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(Math.ceil(cooldownSeconds - elapsedSinceLastSec), 1),
    };
  }

  if (elapsedWindowSec >= windowSeconds) {
    memoryBuckets.set(keyHash, {
      windowStartedAtMs: nowMs,
      requestCount: 1,
      lastRequestAtMs: nowMs,
    });
    return {
      allowed: true,
      remaining: Math.max(maxRequests - 1, 0),
      retryAfterSeconds: 0,
    };
  }

  if (existing.requestCount >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(Math.ceil(windowSeconds - elapsedWindowSec), 1),
    };
  }

  existing.requestCount += 1;
  existing.lastRequestAtMs = nowMs;
  memoryBuckets.set(keyHash, existing);

  return {
    allowed: true,
    remaining: Math.max(maxRequests - existing.requestCount, 0),
    retryAfterSeconds: 0,
  };
}

/**
 * Checks and increments an atomic rate limit bucket keyed by HMAC(scope, identifier).
 * Never stores or logs the raw phone number or IP address.
 */
export async function checkRateLimit(
  identifier: string,
  policy: RateLimitPolicy,
): Promise<RateLimitResult> {
  const keyHash = hmacHash(`rl:${policy.scope}`, identifier);
  const cooldownSeconds = policy.cooldownSeconds ?? 0;

  if (isSupabaseAdminConfigured()) {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.rpc("consume_rate_limit", {
        p_key_hash: keyHash,
        p_max_requests: policy.maxRequests,
        p_window_seconds: policy.windowSeconds,
        p_cooldown_seconds: cooldownSeconds,
      });

      if (!error && Array.isArray(data) && data.length > 0) {
        const row = data[0] as {
          allowed: boolean;
          remaining: number;
          retry_after_seconds: number;
        };
        return {
          allowed: Boolean(row.allowed),
          remaining: Number(row.remaining ?? 0),
          retryAfterSeconds: Number(row.retry_after_seconds ?? 0),
        };
      }

      if (error) {
        logger.warn("rate_limit.db_fallback", {
          scope: policy.scope,
          code: error.code,
        });
      }
    } catch (err) {
      logger.warn("rate_limit.db_exception", {
        scope: policy.scope,
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return consumeInMemoryRateLimit(
    keyHash,
    policy.maxRequests,
    policy.windowSeconds,
    cooldownSeconds,
  );
}

export const OTP_RATE_LIMITS = {
  requestByPhone: {
    scope: "otp_req_phone",
    maxRequests: 3,
    windowSeconds: 15 * 60,
    cooldownSeconds: 60,
  },
  requestByIp: {
    scope: "otp_req_ip",
    maxRequests: 10,
    windowSeconds: 15 * 60,
    cooldownSeconds: 0,
  },
  verifyByPhone: {
    scope: "otp_verify_phone",
    maxRequests: 5,
    windowSeconds: 15 * 60,
    cooldownSeconds: 0,
  },
  verifyByIp: {
    scope: "otp_verify_ip",
    maxRequests: 15,
    windowSeconds: 15 * 60,
    cooldownSeconds: 0,
  },
  artisanSubmitByUser: {
    scope: "artisan_submit_user",
    maxRequests: 5,
    windowSeconds: 60 * 60,
    cooldownSeconds: 15,
  },
  guarantorOtpRequestByToken: {
    scope: "guarantor_otp_req",
    maxRequests: 3,
    windowSeconds: 15 * 60,
    cooldownSeconds: 60,
  },
  guarantorOtpVerifyByToken: {
    scope: "guarantor_otp_verify",
    maxRequests: 5,
    windowSeconds: 15 * 60,
    cooldownSeconds: 0,
  },
  adminSignedUrlByAdmin: {
    scope: "admin_signed_url",
    maxRequests: 30,
    windowSeconds: 15 * 60,
    cooldownSeconds: 0,
  },
} as const;
