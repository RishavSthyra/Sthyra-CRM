import { createHmac, timingSafeEqual } from "node:crypto";

export const TENANT_AUTH_HEADER = "x-sthyra-auth-context";
const CONTEXT_TTL_SECONDS = 5 * 60;

export type TenantAuthContext = {
  authUserId: string;
  sessionId: string | null;
  workspaceSlug: string | null;
};

function getSigningSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters");
  }
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", getSigningSecret())
    .update(value)
    .digest("base64url");
}

export function createTenantAuthContext(
  authUserId: string,
  workspaceSlug: string | null = null,
  sessionId: string | null = null,
): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const tenant = workspaceSlug ?? "-";
  const session = sessionId ?? "-";
  const payload = `${authUserId}.${tenant}.${session}.${issuedAt}`;
  return `${payload}.${sign(payload)}`;
}

export function readTenantAuthContext(
  value: string | null,
): TenantAuthContext | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4 && parts.length !== 5) return null;
  const [authUserId, tenant] = parts;
  const sessionId = parts.length === 5 ? parts[2] : "-";
  const issuedAtValue = parts.at(-2)!;
  const signature = parts.at(-1)!;
  if (!/^[0-9a-f-]{36}$/i.test(authUserId)) return null;
  if (tenant !== "-" && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tenant)) {
    return null;
  }
  if (sessionId !== "-" && !/^[0-9a-f-]{36}$/i.test(sessionId)) return null;

  const issuedAt = Number(issuedAtValue);
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > now + 30 ||
    issuedAt < now - CONTEXT_TTL_SECONDS
  ) {
    return null;
  }

  const payload =
    parts.length === 5
      ? `${authUserId}.${tenant}.${sessionId}.${issuedAtValue}`
      : `${authUserId}.${tenant}.${issuedAtValue}`;
  const expected = Buffer.from(sign(payload), "base64url");
  const received = Buffer.from(signature, "base64url");
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null;
  }
  return {
    authUserId,
    sessionId: sessionId === "-" ? null : sessionId,
    workspaceSlug: tenant === "-" ? null : tenant,
  };
}
