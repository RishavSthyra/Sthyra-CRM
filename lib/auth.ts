import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { isIP } from "node:net";
import type { ScryptOptions } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

const ACCESS_COOKIE = "sthyra_access_token";
const REFRESH_COOKIE = "sthyra_refresh_token";
const ACCESS_TOKEN_SECONDS = 15 * 60;
export const REFRESH_TOKEN_DAYS = 30;

const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 3;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 128 * 1024 * 1024;

export const AUTH_USER_COLUMNS = `
  u.user_id,
  u.team_id,
  u.role_id,
  u.username,
  u.first_name,
  u.last_name,
  u.email,
  u.phone,
  u.is_active,
  u.last_login,
  u.password_changed_at,
  u.created_at,
  u.updated_at
`;

type AccessTokenPayload = {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
};

export type AuthenticatedUser = {
  sessionId: string;
  user: Record<string, unknown> & { user_id: string };
};

export type AuthenticationResult =
  | { ok: true; auth: AuthenticatedUser }
  | { ok: false; response: NextResponse };

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters");
  }
  return secret;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(value: string): string {
  return createHmac("sha256", getAuthSecret())
    .update(value)
    .digest("base64url");
}

export function createAccessToken(userId: string, sessionId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    sub: userId,
    sid: sessionId,
    iat: now,
    exp: now + ACCESS_TOKEN_SECONDS,
  });
  const unsignedToken = `${header}.${payload}`;
  return `${unsignedToken}.${sign(unsignedToken)}`;
}

function verifyAccessToken(token: string): AccessTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = JSON.parse(
      Buffer.from(headerPart, "base64url").toString("utf8"),
    );
    if (header.alg !== "HS256" || header.typ !== "JWT") {
      return null;
    }

    const expected = Buffer.from(
      sign(`${headerPart}.${payloadPart}`),
      "base64url",
    );
    const received = Buffer.from(signaturePart, "base64url");
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8"),
    ) as Partial<AccessTokenPayload>;
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof payload.sub !== "string" ||
      typeof payload.sid !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.iat > now + 60 ||
      payload.exp <= now
    ) {
      return null;
    }
    return payload as AccessTokenPayload;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEMORY,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string | null,
): Promise<boolean> {
  if (!storedHash) {
    return false;
  }
  const [algorithm, nValue, rValue, pValue, saltValue, hashValue, ...rest] =
    storedHash.split("$");
  if (algorithm !== "scrypt" || rest.length > 0) {
    return false;
  }

  const N = Number(nValue);
  const r = Number(rValue);
  const p = Number(pValue);
  if (
    !Number.isSafeInteger(N) ||
    !Number.isSafeInteger(r) ||
    !Number.isSafeInteger(p) ||
    N < 2 ** 14 ||
    N > 2 ** 18 ||
    r < 1 ||
    r > 16 ||
    p < 1 ||
    p > 4
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");
    if (salt.length < 16 || expected.length !== SCRYPT_KEY_LENGTH) {
      return false;
    }
    const actual = await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAX_MEMORY,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getRequestIp(request: NextRequest): string | null {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    .trim();
  const candidate = forwarded || request.headers.get("x-real-ip")?.trim();
  return candidate && isIP(candidate) !== 0 ? candidate : null;
}

export function setAuthCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string,
): void {
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: ACCESS_TOKEN_SECONDS,
  });
  response.cookies.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/api/auth",
    maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60,
  });
}

export function clearAuthCookies(response: NextResponse): void {
  const secure = process.env.NODE_ENV === "production";
  for (const [name, path] of [
    [ACCESS_COOKIE, "/"],
    [REFRESH_COOKIE, "/api/auth"],
  ] as const) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path,
      expires: new Date(0),
      maxAge: 0,
    });
  }
}

export function getRefreshToken(request: NextRequest): string | null {
  return request.cookies.get(REFRESH_COOKIE)?.value ?? null;
}

function getAccessToken(request: NextRequest): string | null {
  return request.cookies.get(ACCESS_COOKIE)?.value ?? null;
}

export async function authenticateRequest(
  request: NextRequest,
): Promise<AuthenticationResult> {
  try {
    const token = getAccessToken(request);
    const payload = token ? verifyAccessToken(token) : null;
    if (!payload) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Authentication required" },
          { status: 401 },
        ),
      };
    }

    const result = await pool.query(
      `SELECT ${AUTH_USER_COLUMNS}
       FROM auth_sessions s
       JOIN users u ON u.user_id = s.user_id
       WHERE s.session_id = $1
         AND s.user_id = $2
         AND s.revoked_at IS NULL
         AND s.expires_at > CURRENT_TIMESTAMP
         AND u.is_active = TRUE
         AND u.deleted_at IS NULL`,
      [payload.sid, payload.sub],
    );
    if (result.rowCount === 0) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Authentication required" },
          { status: 401 },
        ),
      };
    }

    return {
      ok: true,
      auth: { sessionId: payload.sid, user: result.rows[0] },
    };
  } catch (error) {
    console.error("Failed to authenticate request", error);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authentication is unavailable" },
        { status: 500 },
      ),
    };
  }
}
