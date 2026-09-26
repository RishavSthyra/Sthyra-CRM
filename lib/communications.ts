import type { PoolClient } from "pg";
import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export const CALL_COLUMNS = `
  c.call_id, c.company_id, c.project_id, c.lead_id, c.contact_id,
  c.direction, c.status, c.outcome, c.phone_number, c.subject, c.summary,
  c.started_at, c.ended_at, c.duration_seconds, c.owner_user_id,
  c.provider, c.provider_call_id, c.provider_parent_call_id,
  c.provider_metadata, c.initiated_at, c.answered_at, c.muted, c.on_hold,
  c.recording_id, c.recording_status, c.updated_by,
  c.created_by, c.created_at, c.updated_at
`;

export const EMAIL_COLUMNS = `
  e.email_id, e.company_id, e.project_id, e.lead_id, e.contact_id,
  e.direction, e.status, e.subject, e.body, e.from_address, e.to_addresses,
  e.cc_addresses, e.sent_at, e.received_at, e.opened_at, e.replied_at,
  e.email_connection_id, e.provider, e.provider_message_id,
  e.provider_thread_id, e.internet_message_id, e.in_reply_to,
  e.delivery_error, e.queued_at,
  e.owner_user_id, e.created_by, e.created_at, e.updated_at
`;

type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] };

type CallInput = {
  project_id: number;
  lead_id?: string | null;
  contact_id?: string | null;
  direction?: "inbound" | "outbound";
  status?:
    | "scheduled"
    | "initiating"
    | "queued"
    | "ringing"
    | "answered"
    | "in_progress"
    | "on_hold"
    | "missed"
    | "completed"
    | "failed"
    | "busy"
    | "no_answer"
    | "cancelled";
  outcome?:
    | "interested"
    | "follow_up"
    | "no_answer"
    | "not_interested"
    | "wrong_number"
    | "voicemail"
    | "connected"
    | "callback_requested"
    | "qualified"
    | "do_not_call"
    | null;
  phone_number: string;
  subject: string;
  summary?: string | null;
  started_at: string;
  ended_at?: string | null;
  duration_seconds?: number | null;
};

type EmailInput = {
  project_id: number;
  email_connection_id?: string | null;
  lead_id?: string | null;
  contact_id?: string | null;
  direction?: "inbound" | "outbound";
  status?:
    | "draft"
    | "scheduled"
    | "queued"
    | "sending"
    | "sent"
    | "delivered"
    | "opened"
    | "replied"
    | "bounced"
    | "failed"
    | "cancelled"
    | "received";
  subject: string;
  body: string;
  from_address?: string;
  to_addresses: string[];
  cc_addresses?: string[];
  sent_at?: string | null;
  received_at?: string | null;
};

export type EmailAttachmentInput = {
  file_name: string;
  mime_type: string;
  size_bytes: number;
  content: Buffer;
};

function positiveProject(value: unknown, errors: string[]) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    errors.push("project_id must be a positive integer");
    return 0;
  }
  return Number(value);
}

function uuid(value: unknown, field: string, errors: string[]) {
  if (value === undefined || value === null) return value as null | undefined;
  if (!isUuid(value)) {
    errors.push(`${field} must be a valid UUID or null`);
    return undefined;
  }
  return String(value).toLowerCase();
}

function timestamp(
  value: unknown,
  field: string,
  nullable: boolean,
  errors: string[],
) {
  if (value === undefined) return undefined;
  if (value === null && nullable) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    errors.push(`${field} must be a valid ISO date-time${nullable ? " or null" : ""}`);
    return undefined;
  }
  return new Date(value).toISOString();
}

function oneOf<T extends string>(
  value: unknown,
  field: string,
  values: readonly T[],
  errors: string[],
): T | undefined {
  if (value === undefined) return undefined;
  if (!values.includes(value as T)) {
    errors.push(`${field} must be one of: ${values.join(", ")}`);
    return undefined;
  }
  return value as T;
}

function emailList(value: unknown, field: string, required: boolean, errors: string[]) {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || (required && value.length === 0)) {
    errors.push(`${field} must be ${required ? "a non-empty" : "an"} array of email addresses`);
    return undefined;
  }
  const addresses = value.map((item) => String(item).trim().toLowerCase());
  if (addresses.some((address) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))) {
    errors.push(`${field} contains an invalid email address`);
    return undefined;
  }
  return addresses;
}

export function validateCallPayload(body: unknown): ValidationResult<CallInput> {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const errors: string[] = [];
  const projectId = positiveProject(body.project_id, errors);
  const leadId = uuid(body.lead_id, "lead_id", errors);
  const contactId = uuid(body.contact_id, "contact_id", errors);
  const direction = oneOf(body.direction, "direction", ["inbound", "outbound"] as const, errors);
  const status = oneOf(
    body.status,
    "status",
    ["scheduled", "initiating", "queued", "ringing", "answered", "in_progress", "on_hold", "missed", "completed", "failed", "busy", "no_answer", "cancelled"] as const,
    errors,
  );
  const outcome =
    body.outcome === null
      ? null
      : oneOf(
          body.outcome,
          "outcome",
          ["interested", "follow_up", "no_answer", "not_interested", "wrong_number", "voicemail", "connected", "callback_requested", "qualified", "do_not_call"] as const,
          errors,
        );
  const phoneNumber = validateText(body.phone_number, "phone_number", 30, false, errors);
  const subject = validateText(body.subject, "subject", 250, false, errors);
  const summary = validateText(body.summary, "summary", 10000, true, errors);
  const startedAt = timestamp(body.started_at, "started_at", false, errors);
  const endedAt = timestamp(body.ended_at, "ended_at", true, errors);
  let duration: number | null | undefined;
  if (body.duration_seconds !== undefined) {
    if (body.duration_seconds === null) duration = null;
    else if (!Number.isSafeInteger(body.duration_seconds) || Number(body.duration_seconds) < 0)
      errors.push("duration_seconds must be a non-negative integer or null");
    else duration = Number(body.duration_seconds);
  }
  if (startedAt && endedAt && new Date(endedAt) < new Date(startedAt)) {
    errors.push("ended_at must not be earlier than started_at");
  }
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        data: {
          project_id: projectId,
          lead_id: leadId,
          contact_id: contactId,
          direction,
          status,
          outcome,
          phone_number: phoneNumber as string,
          subject: subject as string,
          summary,
          started_at: startedAt as string,
          ended_at: endedAt,
          duration_seconds: duration,
        },
      };
}

export function validateEmailPayload(body: unknown): ValidationResult<EmailInput> {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const errors: string[] = [];
  const projectId = positiveProject(body.project_id, errors);
  const emailConnectionId = uuid(
    body.email_connection_id,
    "email_connection_id",
    errors,
  );
  const leadId = uuid(body.lead_id, "lead_id", errors);
  const contactId = uuid(body.contact_id, "contact_id", errors);
  const direction = oneOf(body.direction, "direction", ["inbound", "outbound"] as const, errors);
  const status = oneOf(
    body.status,
    "status",
    ["draft", "scheduled", "queued", "sending", "sent", "delivered", "opened", "replied", "bounced", "failed", "cancelled", "received"] as const,
    errors,
  );
  const subject = validateText(body.subject, "subject", 250, false, errors);
  const emailBody = validateText(body.body, "body", 50000, false, errors);
  const fromAddress = validateText(body.from_address, "from_address", 255, true, errors);
  if (fromAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
    errors.push("from_address must be a valid email address");
  }
  const toAddresses = emailList(body.to_addresses, "to_addresses", true, errors);
  const ccAddresses = emailList(body.cc_addresses, "cc_addresses", false, errors);
  const sentAt = timestamp(body.sent_at, "sent_at", true, errors);
  const receivedAt = timestamp(body.received_at, "received_at", true, errors);
  const resolvedDirection = direction ?? "outbound";
  if (resolvedDirection === "outbound" && !emailConnectionId) {
    errors.push("email_connection_id is required for outbound email");
  }
  if (resolvedDirection === "inbound" && !fromAddress) {
    errors.push("from_address is required for inbound email");
  }
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        data: {
          project_id: projectId,
          email_connection_id: emailConnectionId,
          lead_id: leadId,
          contact_id: contactId,
          direction,
          status,
          subject: subject as string,
          body: emailBody as string,
          from_address: fromAddress?.toLowerCase(),
          to_addresses: toAddresses as string[],
          cc_addresses: ccAddresses,
          sent_at: sentAt,
          received_at: receivedAt,
        },
      };
}

export function validateEmailAttachments(
  value: unknown,
): ValidationResult<EmailAttachmentInput[]> {
  if (value === undefined) return { ok: true, data: [] };
  if (!Array.isArray(value)) {
    return { ok: false, errors: ["attachments must be an array"] };
  }
  if (value.length > 10) {
    return { ok: false, errors: ["A maximum of 10 attachments is allowed"] };
  }
  const errors: string[] = [];
  const attachments: EmailAttachmentInput[] = [];
  let totalBytes = 0;
  value.forEach((item, index) => {
    if (!isObject(item) || Array.isArray(item)) {
      errors.push(`attachments[${index}] must be an object`);
      return;
    }
    const name = validateText(
      item.file_name,
      `attachments[${index}].file_name`,
      255,
      false,
      errors,
    );
    const mimeType = validateText(
      item.mime_type,
      `attachments[${index}].mime_type`,
      255,
      false,
      errors,
    );
    if (
      !Number.isSafeInteger(item.size_bytes) ||
      Number(item.size_bytes) < 1 ||
      Number(item.size_bytes) > 10 * 1024 * 1024
    ) {
      errors.push(`attachments[${index}].size_bytes must be between 1 byte and 10 MB`);
      return;
    }
    if (typeof item.content_base64 !== "string" || !item.content_base64) {
      errors.push(`attachments[${index}].content_base64 is required`);
      return;
    }
    const content = Buffer.from(item.content_base64, "base64");
    if (content.length !== Number(item.size_bytes)) {
      errors.push(`attachments[${index}] content does not match its declared size`);
      return;
    }
    totalBytes += content.length;
    attachments.push({
      file_name: String(name).replace(/[\\/]/g, "_"),
      mime_type: String(mimeType || "application/octet-stream"),
      size_bytes: content.length,
      content,
    });
  });
  if (totalBytes > 20 * 1024 * 1024) {
    errors.push("Attachments may not exceed 20 MB in total");
  }
  return errors.length ? { ok: false, errors } : { ok: true, data: attachments };
}

export async function resolveCommunicationContact(
  client: PoolClient,
  companyId: number,
  projectId: number,
  leadId?: string | null,
  contactId?: string | null,
): Promise<string | null> {
  if (leadId) {
    const lead = await client.query(
      `SELECT l.contact_id
       FROM leads l JOIN projects p ON p.project_id=l.project_id
       WHERE l.lead_id=$1 AND l.project_id=$2 AND p.company_id=$3`,
      [leadId, projectId, companyId],
    );
    if (!lead.rowCount) throw new Error("lead_id must belong to the selected project");
    if (contactId && lead.rows[0].contact_id !== contactId) {
      throw new Error("contact_id does not match the selected lead");
    }
    return contactId ?? lead.rows[0].contact_id ?? null;
  }
  if (contactId) {
    const contact = await client.query(
      "SELECT 1 FROM contacts WHERE contact_id=$1 AND archived_at IS NULL",
      [contactId],
    );
    if (!contact.rowCount) throw new Error("contact_id was not found");
  }
  return contactId ?? null;
}
