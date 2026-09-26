import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

type Queryable = Pick<Pool | PoolClient, "query">;
type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: string[] };

export const CALL_STATUSES = ["scheduled", "initiating", "queued", "ringing", "answered", "in_progress", "on_hold", "missed", "completed", "failed", "busy", "no_answer", "cancelled"] as const;
export const TERMINAL_CALL_STATUSES = new Set(["missed", "completed", "failed", "busy", "no_answer", "cancelled"]);
export const ACTIVE_CALL_STATUSES = new Set(["ringing", "answered", "in_progress", "on_hold"]);
export const CALL_OUTCOMES = ["interested", "follow_up", "no_answer", "not_interested", "wrong_number", "voicemail", "connected", "callback_requested", "qualified", "do_not_call"] as const;

export function verifyTelephonyWebhook(rawBody: string, signature: string | null, authorization: string | null): boolean {
  const secret = process.env.TELEPHONY_WEBHOOK_SECRET;
  if (!secret) return false;
  if (authorization === `Bearer ${secret}`) return true;
  if (!signature) return false;
  const supplied = signature.replace(/^sha256=/i, "").trim();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied.toLowerCase()), Buffer.from(expected));
}

export function telephonyConfigured() {
  return Boolean(process.env.TELEPHONY_PROVIDER_API_URL && process.env.TELEPHONY_PROVIDER_API_KEY);
}

export async function providerRequest(path: string, method: "GET" | "POST", body?: unknown) {
  if (!telephonyConfigured()) {
    if (process.env.TELEPHONY_ALLOW_SIMULATION === "true")
      return { simulated: true, id: `sim_${crypto.randomUUID()}`, status: "queued" };
    throw new Error("TELEPHONY_NOT_CONFIGURED");
  }
  const baseUrl = process.env.TELEPHONY_PROVIDER_API_URL!.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.TELEPHONY_PROVIDER_API_KEY}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Telephony provider returned ${response.status}`);
  return payload;
}

function uuid(value: unknown, field: string, errors: string[]) {
  if (value === undefined || value === null) return value as null | undefined;
  if (!isUuid(value)) { errors.push(`${field} must be a valid UUID or null`); return undefined; }
  return String(value).toLowerCase();
}

export type InitiateCallInput = { project_id: number; lead_id?: string | null; contact_id?: string | null; phone_number?: string; subject: string };
export function validateInitiateCall(body: unknown): ValidationResult<InitiateCallInput> {
  if (!isObject(body) || Array.isArray(body)) return { ok: false, errors: ["Request body must be a JSON object"] };
  const allowed = new Set(["project_id", "lead_id", "contact_id", "phone_number", "subject"]);
  const errors = Object.keys(body).filter((key) => !allowed.has(key)).map((key) => `Unknown field: ${key}`);
  const project = Number(body.project_id);
  if (!Number.isSafeInteger(body.project_id) || project <= 0) errors.push("project_id must be a positive integer");
  const lead = uuid(body.lead_id, "lead_id", errors);
  const contact = uuid(body.contact_id, "contact_id", errors);
  const phone = validateText(body.phone_number, "phone_number", 30, true, errors);
  const subject = validateText(body.subject, "subject", 250, false, errors);
  if (!lead && !contact && !phone) errors.push("lead_id, contact_id, or phone_number is required");
  return errors.length ? { ok: false, errors } : { ok: true, data: { project_id: project, lead_id: lead, contact_id: contact, phone_number: phone ?? undefined, subject: subject as string } };
}

export function validateDisposition(body: unknown): ValidationResult<{ outcome: typeof CALL_OUTCOMES[number]; summary?: string | null }> {
  if (!isObject(body) || Array.isArray(body)) return { ok: false, errors: ["Request body must be a JSON object"] };
  const errors: string[] = [];
  if (!CALL_OUTCOMES.includes(body.outcome as typeof CALL_OUTCOMES[number])) errors.push(`outcome must be one of: ${CALL_OUTCOMES.join(", ")}`);
  const summary = validateText(body.summary, "summary", 10000, true, errors);
  return errors.length ? { ok: false, errors } : { ok: true, data: { outcome: body.outcome as typeof CALL_OUTCOMES[number], summary } };
}

export function validateTransfer(body: unknown): ValidationResult<{ to_user_id?: string; to_team_id?: string; to_phone_number?: string }> {
  if (!isObject(body) || Array.isArray(body)) return { ok: false, errors: ["Request body must be a JSON object"] };
  const errors: string[] = [];
  const user = uuid(body.to_user_id, "to_user_id", errors) ?? undefined;
  const team = uuid(body.to_team_id, "to_team_id", errors) ?? undefined;
  const phone = validateText(body.to_phone_number, "to_phone_number", 30, true, errors) ?? undefined;
  if ([user, team, phone].filter(Boolean).length !== 1) errors.push("Provide exactly one of to_user_id, to_team_id, or to_phone_number");
  return errors.length ? { ok: false, errors } : { ok: true, data: { to_user_id: user, to_team_id: team, to_phone_number: phone } };
}

export async function getCallForUpdate(db: Queryable, callId: string) {
  const result = await db.query("SELECT * FROM calls WHERE call_id=$1 FOR UPDATE", [callId]);
  return result.rows[0] ?? null;
}

export async function addCallHistory(db: Queryable, callId: string, action: string, fromStatus: string | null, toStatus: string | null, actorUserId: string | null, metadata: Record<string, unknown> = {}) {
  await db.query(
    `INSERT INTO call_state_history (call_id, action, from_status, to_status, actor_user_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)`, [callId, action, fromStatus, toStatus, actorUserId, metadata],
  );
}

export function mapProviderStatus(status: unknown): string | null {
  const normalized = String(status ?? "").toLowerCase().replace(/-/g, "_");
  const aliases: Record<string, string> = { initiated: "initiating", started: "in_progress", active: "in_progress", connected: "in_progress", ended: "completed", canceled: "cancelled", rejected: "failed" };
  const mapped = aliases[normalized] ?? normalized;
  return CALL_STATUSES.includes(mapped as typeof CALL_STATUSES[number]) ? mapped : null;
}
