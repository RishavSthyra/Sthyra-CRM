import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey() {
  const configured = (
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY ||
    process.env.EMAIL_TOKEN_ENCRYPTION_KEY ||
    ""
  ).trim();
  if (!configured) {
    throw new Error("INTEGRATION_TOKEN_ENCRYPTION_KEY is not configured");
  }
  const key = /^[a-f\d]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) {
    throw new Error(
      "INTEGRATION_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes",
    );
  }
  return key;
}

export function encryptIntegrationToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptIntegrationToken(value: string) {
  const [version, ivValue, tagValue, ciphertextValue, ...rest] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue || rest.length) {
    throw new Error("Encrypted integration token has an unsupported format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

