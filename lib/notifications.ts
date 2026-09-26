import type { Pool, PoolClient } from "pg";
import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

type Queryable = Pick<Pool | PoolClient, "query">;
type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: string[] };

export const NOTIFICATION_COLUMNS = `
  n.notification_id, n.company_id, n.project_id, n.user_id, n.template_id,
  n.notification_type, n.title, n.body, n.severity, n.entity_type,
  n.entity_id, n.action_url, n.metadata, n.is_read, n.read_at,
  n.expires_at, n.created_at
`;

export const TEMPLATE_COLUMNS = `
  nt.template_id, nt.company_id, nt.project_id, nt.template_key,
  nt.template_name, nt.description, nt.channels, nt.subject_template,
  nt.body_template, nt.severity, nt.action_url_template, nt.variables,
  nt.is_active, nt.created_by, nt.updated_by, nt.created_at, nt.updated_at
`;

export const DELIVERY_COLUMNS = `
  nd.delivery_id, nd.notification_id, nd.template_id, nd.user_id,
  nd.channel, nd.recipient, nd.status, nd.attempt_count, nd.max_attempts,
  nd.provider_message_id, nd.error_message, nd.payload, nd.next_attempt_at,
  nd.sent_at, nd.failed_at, nd.created_at, nd.updated_at
`;

export const ADMIN_ROLE_KEYS = new Set(["COMPANY_OWNER", "COMPANY_ADMIN", "SUPER_ADMIN"]);

export function parseNotificationUuid(value: string): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

function booleanField(value: unknown, field: string, errors: string[]) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    errors.push(`${field} must be a boolean`);
    return undefined;
  }
  return value;
}

function timeField(value: unknown, field: string, errors: string[]) {
  if (value === undefined || value === null) return value as null | undefined;
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) {
    errors.push(`${field} must be HH:MM, HH:MM:SS, or null`);
    return undefined;
  }
  return value;
}

export type NotificationPreferencePatch = {
  in_app_enabled?: boolean;
  email_enabled?: boolean;
  push_enabled?: boolean;
  lead_assignment_enabled?: boolean;
  task_enabled?: boolean;
  appointment_enabled?: boolean;
  opportunity_enabled?: boolean;
  transfer_enabled?: boolean;
  telephony_enabled?: boolean;
  digest_frequency?: "instant" | "daily" | "weekly" | "never";
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  timezone?: string;
};

export function validateNotificationPreferences(body: unknown): ValidationResult<NotificationPreferencePatch> {
  if (!isObject(body) || Array.isArray(body))
    return { ok: false, errors: ["Request body must be a JSON object"] };
  const allowed = new Set([
    "in_app_enabled", "email_enabled", "push_enabled", "lead_assignment_enabled",
    "task_enabled", "appointment_enabled", "opportunity_enabled", "transfer_enabled",
    "telephony_enabled", "digest_frequency", "quiet_hours_start", "quiet_hours_end", "timezone",
  ]);
  const errors = Object.keys(body).filter((key) => !allowed.has(key)).map((key) => `Unknown field: ${key}`);
  if (!Object.keys(body).length) errors.push("At least one field is required");
  const data: NotificationPreferencePatch = {};
  for (const field of [
    "in_app_enabled", "email_enabled", "push_enabled", "lead_assignment_enabled",
    "task_enabled", "appointment_enabled", "opportunity_enabled", "transfer_enabled", "telephony_enabled",
  ] as const) {
    const value = booleanField(body[field], field, errors);
    if (value !== undefined) data[field] = value;
  }
  if (body.digest_frequency !== undefined) {
    if (!["instant", "daily", "weekly", "never"].includes(String(body.digest_frequency)))
      errors.push("digest_frequency must be one of: instant, daily, weekly, never");
    else data.digest_frequency = body.digest_frequency as NotificationPreferencePatch["digest_frequency"];
  }
  const start = timeField(body.quiet_hours_start, "quiet_hours_start", errors);
  const end = timeField(body.quiet_hours_end, "quiet_hours_end", errors);
  if (start !== undefined) data.quiet_hours_start = start;
  if (end !== undefined) data.quiet_hours_end = end;
  if ((body.quiet_hours_start === undefined) !== (body.quiet_hours_end === undefined))
    errors.push("quiet_hours_start and quiet_hours_end must be updated together");
  if ((start === null) !== (end === null) && body.quiet_hours_start !== undefined && body.quiet_hours_end !== undefined)
    errors.push("quiet_hours_start and quiet_hours_end must both be set or both be null");
  const timezone = validateText(body.timezone, "timezone", 100, false, errors);
  if (timezone) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); data.timezone = timezone; }
    catch { errors.push("timezone must be a valid IANA timezone"); }
  }
  return errors.length ? { ok: false, errors } : { ok: true, data };
}

export type TemplateInput = {
  project_id?: number | null;
  template_key?: string;
  template_name?: string;
  description?: string | null;
  channels?: Array<"in_app" | "email" | "push">;
  subject_template?: string | null;
  body_template?: string;
  severity?: "info" | "success" | "warning" | "error";
  action_url_template?: string | null;
  variables?: string[];
};

export function validateNotificationTemplate(body: unknown, partial: boolean): ValidationResult<TemplateInput> {
  if (!isObject(body) || Array.isArray(body))
    return { ok: false, errors: ["Request body must be a JSON object"] };
  const allowed = new Set(["project_id", "template_key", "template_name", "description", "channels", "subject_template", "body_template", "severity", "action_url_template", "variables"]);
  const errors = Object.keys(body).filter((key) => !allowed.has(key)).map((key) => `Unknown field: ${key}`);
  const data: TemplateInput = {};
  if (body.project_id !== undefined) {
    if (body.project_id === null) data.project_id = null;
    else if (!Number.isSafeInteger(body.project_id) || Number(body.project_id) <= 0) errors.push("project_id must be a positive integer or null");
    else data.project_id = Number(body.project_id);
  }
  const key = validateText(body.template_key, "template_key", 100, false, errors);
  const name = validateText(body.template_name, "template_name", 180, false, errors);
  const description = validateText(body.description, "description", 5000, true, errors);
  const subject = validateText(body.subject_template, "subject_template", 300, true, errors);
  const templateBody = validateText(body.body_template, "body_template", 20000, false, errors);
  const actionUrl = validateText(body.action_url_template, "action_url_template", 2000, true, errors);
  if (key) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
    if (!normalizedKey) errors.push("template_key must contain a letter or number");
    else data.template_key = normalizedKey;
  }
  if (name) data.template_name = name;
  if (description !== undefined) data.description = description;
  if (subject !== undefined) data.subject_template = subject;
  if (templateBody) data.body_template = templateBody;
  if (actionUrl !== undefined) data.action_url_template = actionUrl;
  if (body.channels !== undefined) {
    if (!Array.isArray(body.channels) || body.channels.length === 0 || body.channels.some((value) => !["in_app", "email", "push"].includes(String(value)))) errors.push("channels must be a non-empty array containing in_app, email, or push");
    else data.channels = [...new Set(body.channels)] as TemplateInput["channels"];
  }
  if (body.severity !== undefined) {
    if (!["info", "success", "warning", "error"].includes(String(body.severity))) errors.push("severity must be one of: info, success, warning, error");
    else data.severity = body.severity as TemplateInput["severity"];
  }
  if (body.variables !== undefined) {
    if (!Array.isArray(body.variables) || body.variables.some((value) => typeof value !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(value))) errors.push("variables must be an array of valid variable names");
    else data.variables = [...new Set(body.variables as string[])];
  }
  if (!partial) {
    if (!data.template_key) errors.push("template_key is required");
    if (!data.template_name) errors.push("template_name is required");
    if (!data.body_template) errors.push("body_template is required");
  } else if (!Object.keys(body).length) errors.push("At least one field is required");
  return errors.length ? { ok: false, errors } : { ok: true, data };
}

export function renderNotificationTemplate(template: string | null, variables: Record<string, unknown>): string | null {
  if (template === null) return null;
  return template.replace(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g, (_match, key: string) => String(variables[key] ?? ""));
}

export async function ensureNotificationPreferences(db: Queryable, userId: string) {
  const result = await db.query(
    `INSERT INTO notification_preferences (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id=EXCLUDED.user_id
     RETURNING *`, [userId],
  );
  return result.rows[0];
}

export type CreateNotificationInput = {
  companyId: number;
  projectId?: number | null;
  userId: string;
  templateId?: string | null;
  type: string;
  title: string;
  body: string;
  severity?: "info" | "success" | "warning" | "error";
  entityType?: string | null;
  entityId?: string | null;
  actionUrl?: string | null;
  metadata?: Record<string, unknown>;
  channels?: Array<"in_app" | "email" | "push">;
};

export async function createNotification(db: Queryable, input: CreateNotificationInput) {
  const preferences = await ensureNotificationPreferences(db, input.userId);
  const channels = (input.channels ?? ["in_app"]).filter((channel) => {
    if (channel === "in_app") return preferences.in_app_enabled;
    if (channel === "email") return preferences.email_enabled;
    return preferences.push_enabled;
  });
  if (!channels.length) return null;
  const result = await db.query(
    `INSERT INTO notifications (company_id, project_id, user_id, template_id,
       notification_type, title, body, severity, entity_type, entity_id, action_url, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [input.companyId, input.projectId ?? null, input.userId, input.templateId ?? null,
      input.type, input.title, input.body, input.severity ?? "info", input.entityType ?? null,
      input.entityId ?? null, input.actionUrl ?? null, input.metadata ?? {}],
  );
  const notification = result.rows[0];
  for (const channel of channels) {
    await db.query(
      `INSERT INTO notification_deliveries (notification_id, template_id, user_id, channel, status, payload, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $4='in_app' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
      [notification.notification_id, input.templateId ?? null, input.userId, channel,
        channel === "in_app" ? "sent" : "queued", { title: input.title, body: input.body }],
    );
  }
  return notification;
}
