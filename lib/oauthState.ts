import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type StateEnvelope<T> = {
  data: T;
  exp: number;
  nonce: string;
};

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters");
  }
  return value;
}

function signature(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createSignedState<T>(data: T, ttlSeconds = 10 * 60): string {
  const envelope: StateEnvelope<T> = {
    data,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    nonce: randomBytes(18).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(envelope)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function readSignedState<T>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [payload, received, ...rest] = token.split(".");
  if (!payload || !received || rest.length) return null;
  try {
    const expectedBytes = Buffer.from(signature(payload), "base64url");
    const receivedBytes = Buffer.from(received, "base64url");
    if (
      expectedBytes.length !== receivedBytes.length ||
      !timingSafeEqual(expectedBytes, receivedBytes)
    ) {
      return null;
    }
    const envelope = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<StateEnvelope<T>>;
    if (
      typeof envelope.exp !== "number" ||
      envelope.exp <= Math.floor(Date.now() / 1000) ||
      typeof envelope.nonce !== "string" ||
      !("data" in envelope)
    ) {
      return null;
    }
    return envelope.data as T;
  } catch {
    return null;
  }
}
