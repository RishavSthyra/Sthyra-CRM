import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminPool } from "@/lib/db";
import { getRequestIp } from "@/lib/auth";

export type RateLimitRule = {
  action: string;
  subject: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

function rateLimitSecret(): string {
  const secret =
    process.env.RATE_LIMIT_HASH_SECRET?.trim() ??
    process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "RATE_LIMIT_HASH_SECRET or AUTH_SECRET must contain at least 32 characters",
    );
  }
  return secret;
}

export function hashRateLimitSubject(subject: string): string {
  return createHmac("sha256", rateLimitSecret())
    .update(subject.trim().toLowerCase())
    .digest("hex");
}

export function requestIpSubject(request: NextRequest): string {
  return `ip:${getRequestIp(request) ?? "unavailable"}`;
}

export async function consumeRateLimit(
  rule: RateLimitRule,
  now = new Date(),
): Promise<RateLimitResult> {
  if (!Number.isSafeInteger(rule.limit) || rule.limit < 1) {
    throw new Error("Rate-limit limit must be a positive integer");
  }
  if (!Number.isSafeInteger(rule.windowSeconds) || rule.windowSeconds < 1) {
    throw new Error("Rate-limit window must be a positive integer");
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const bucketSeconds =
    Math.floor(nowSeconds / rule.windowSeconds) * rule.windowSeconds;
  const bucketStartedAt = new Date(bucketSeconds * 1000);
  const retryAfterSeconds = Math.max(
    1,
    bucketSeconds + rule.windowSeconds - nowSeconds,
  );
  const result = await adminPool.query<{ request_count: number }>(
    `INSERT INTO auth_rate_limits (
       action, subject_hash, bucket_started_at, request_count, updated_at
     ) VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP)
     ON CONFLICT (action, subject_hash, bucket_started_at)
     DO UPDATE SET
       request_count = auth_rate_limits.request_count + 1,
       updated_at = CURRENT_TIMESTAMP
     RETURNING request_count`,
    [rule.action, hashRateLimitSubject(rule.subject), bucketStartedAt],
  );
  const count = Number(result.rows[0]?.request_count ?? rule.limit + 1);
  return {
    allowed: count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds,
  };
}

export async function enforceRateLimits(
  request: NextRequest,
  rules: Array<Omit<RateLimitRule, "subject"> & { subject?: string }>,
): Promise<NextResponse | null> {
  for (const rule of rules) {
    const result = await consumeRateLimit({
      ...rule,
      subject: rule.subject ?? requestIpSubject(request),
    });
    if (!result.allowed) {
      const response = NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      );
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Retry-After", String(result.retryAfterSeconds));
      response.headers.set("X-RateLimit-Limit", String(result.limit));
      response.headers.set("X-RateLimit-Remaining", "0");
      return response;
    }
  }
  return null;
}
