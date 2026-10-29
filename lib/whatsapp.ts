import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isUuid } from "@/lib/permissions";

export const WHATSAPP_TEMPLATE_CATEGORIES = ["AUTHENTICATION", "MARKETING", "UTILITY"] as const;
export const WHATSAPP_AUTOMATION_TRIGGERS = [
  "lead_created",
  "lead_qualified",
  "appointment_created",
  "site_visit_scheduled",
  "site_visit_completed",
  "quotation_sent",
  "quotation_accepted",
  "booking_confirmed",
  "task_created",
] as const;

export type WhatsAppTemplateCategory = (typeof WHATSAPP_TEMPLATE_CATEGORIES)[number];

function tokenKey(): Buffer {
  const configured = (
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY ??
    process.env.EMAIL_TOKEN_ENCRYPTION_KEY
  )?.trim();
  if (!configured) throw new Error("INTEGRATION_TOKEN_ENCRYPTION_KEY is not configured");
  const key = /^[a-f\d]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("Integration encryption key must decode to exactly 32 bytes");
  return key;
}
export function encryptWhatsAppToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptWhatsAppToken(value: string): string {
  const [version, iv, tag, ciphertext, ...extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra.length) {
    throw new Error("Encrypted WhatsApp token has an unsupported format");
  }
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function normalizeWhatsAppPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function isWithinWhatsAppServiceWindow(
  lastInboundAt: string | Date | null | undefined,
  now = new Date(),
): boolean {
  if (!lastInboundAt) return false;
  const inbound = new Date(lastInboundAt).getTime();
  return Number.isFinite(inbound) && now.getTime() >= inbound && now.getTime() - inbound < 24 * 60 * 60 * 1000;
}

export function verifyMetaWebhookSignature(rawBody: string, signature: string | null, appSecret: string | undefined): boolean {
  if (!signature || !appSecret || !signature.startsWith("sha256=")) return false;
  const supplied = signature.slice(7);
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  if (!/^[a-f\d]{64}$/i.test(supplied) || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}

export function parseWhatsAppId(value: unknown): string | null {
  return typeof value === "string" && isUuid(value) ? value.toLowerCase() : null;
}

export function validateTemplateName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_]{1,512}$/.test(normalized) ? normalized : null;
}

export function templateTextParameters(values: unknown): Array<{ type: "text"; text: string }> {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .slice(0, 20)
    .map((value) => ({ type: "text", text: String(value).slice(0, 1024) }));
}

export function renderAutomationParameters(
  parameters: unknown,
  context: Record<string, string | number | null | undefined>,
): string[] {
  if (!Array.isArray(parameters)) return [];
  return parameters.slice(0, 20).map((parameter) => {
    const raw = typeof parameter === "string" ? parameter : "";
    return raw.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_match, key: string) =>
      String(context[key.toLowerCase()] ?? ""),
    ).slice(0, 1024);
  });
}
