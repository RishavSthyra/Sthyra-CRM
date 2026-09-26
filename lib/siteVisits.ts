import type { Pool, PoolClient } from "pg";
import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

type Queryable = Pick<Pool | PoolClient, "query">;
type ValidationResult<T> =
  { ok: true; data: T } | { ok: false; errors: string[] };

export const SITE_VISIT_COLUMNS = `
  ap.appointment_id AS visit_id, ap.company_id, ap.project_id, ap.lead_id,
  ap.opportunity_id, ap.contact_id, ap.title, ap.description, ap.location,
  ap.meeting_url, ap.starts_at, ap.ends_at, ap.timezone, ap.status,
  ap.organizer_user_id, ap.assigned_to_user_id, ap.assigned_to_team_id,
  ap.created_by, ap.updated_by, ap.confirmed_at, ap.confirmed_by,
  ap.completed_at, ap.completed_by, ap.cancelled_at, ap.cancelled_by,
  ap.cancellation_reason, ap.reschedule_reason, ap.created_at, ap.updated_at,
  sv.arrival_instructions, sv.transport_notes, sv.attendee_count,
  sv.check_in_at, sv.checked_in_by, sv.check_in_latitude,
  sv.check_in_longitude, sv.check_in_notes, sv.outcome, sv.feedback,
  sv.customer_rating, sv.next_action, sv.no_show_at, sv.no_show_by,
  sv.no_show_reason, sv.reschedule_count
`;

export const SITE_VISIT_STATUSES = [
  "scheduled",
  "confirmed",
  "rescheduled",
  "checked_in",
  "completed",
  "no_show",
  "cancelled",
] as const;
export const TERMINAL_SITE_VISIT_STATUSES = new Set([
  "completed",
  "no_show",
  "cancelled",
]);

export function parseVisitUuid(value: string): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

function uuid(value: unknown, field: string, errors: string[]) {
  if (value === undefined || value === null) return value as null | undefined;
  if (!isUuid(value)) {
    errors.push(`${field} must be a valid UUID or null`);
    return undefined;
  }
  return String(value).toLowerCase();
}

function positiveInteger(
  value: unknown,
  field: string,
  errors: string[],
  nullable = false,
) {
  if (value === undefined) return undefined;
  if (value === null && nullable) return null;
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    errors.push(
      `${field} must be a positive integer${nullable ? " or null" : ""}`,
    );
    return undefined;
  }
  return Number(value);
}

function timestamp(value: unknown, field: string, errors: string[]) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    errors.push(`${field} must be a valid ISO date-time`);
    return undefined;
  }
  return new Date(value).toISOString();
}

export type SiteVisitInput = {
  project_id?: number;
  lead_id?: string | null;
  opportunity_id?: string | null;
  contact_id?: string | null;
  title?: string;
  description?: string | null;
  location?: string | null;
  meeting_url?: string | null;
  starts_at?: string;
  ends_at?: string;
  timezone?: string;
  organizer_user_id?: string | null;
  assigned_to_user_id?: string | null;
  assigned_to_team_id?: string | null;
  arrival_instructions?: string | null;
  transport_notes?: string | null;
  attendee_count?: number | null;
};

export function validateSiteVisitPayload(
  body: unknown,
  partial: boolean,
): ValidationResult<SiteVisitInput> {
  if (!isObject(body) || Array.isArray(body))
    return { ok: false, errors: ["Request body must be a JSON object"] };
  const allowed = new Set([
    "project_id",
    "lead_id",
    "opportunity_id",
    "contact_id",
    "title",
    "description",
    "location",
    "meeting_url",
    "starts_at",
    "ends_at",
    "timezone",
    "organizer_user_id",
    "assigned_to_user_id",
    "assigned_to_team_id",
    "arrival_instructions",
    "transport_notes",
    "attendee_count",
  ]);
  const errors = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .map((key) => `Unknown field: ${key}`);
  const data: SiteVisitInput = {};
  const project = positiveInteger(body.project_id, "project_id", errors);
  if (typeof project === "number") data.project_id = project;
  for (const field of [
    "lead_id",
    "opportunity_id",
    "contact_id",
    "organizer_user_id",
    "assigned_to_user_id",
    "assigned_to_team_id",
  ] as const) {
    const value = uuid(body[field], field, errors);
    if (value !== undefined) data[field] = value;
  }
  for (const [field, maximum, nullable] of [
    ["title", 250, false],
    ["description", 10000, true],
    ["location", 500, true],
    ["meeting_url", 2000, true],
    ["timezone", 100, false],
    ["arrival_instructions", 5000, true],
    ["transport_notes", 5000, true],
  ] as const) {
    const value = validateText(body[field], field, maximum, nullable, errors);
    if (value !== undefined) data[field] = value as never;
  }
  if (data.meeting_url) {
    try {
      const url = new URL(data.meeting_url);
      if (!["http:", "https:"].includes(url.protocol))
        errors.push("meeting_url must use http or https");
    } catch {
      errors.push("meeting_url must be a valid URL");
    }
  }
  if (data.timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: data.timezone });
    } catch {
      errors.push("timezone must be a valid IANA timezone");
    }
  }
  const starts = timestamp(body.starts_at, "starts_at", errors);
  const ends = timestamp(body.ends_at, "ends_at", errors);
  if (starts) data.starts_at = starts;
  if (ends) data.ends_at = ends;
  if (starts && ends && Date.parse(ends) <= Date.parse(starts))
    errors.push("ends_at must be after starts_at");
  if (body.attendee_count !== undefined) {
    if (body.attendee_count === null) data.attendee_count = null;
    else if (
      !Number.isSafeInteger(body.attendee_count) ||
      Number(body.attendee_count) < 0
    )
      errors.push("attendee_count must be a non-negative integer or null");
    else data.attendee_count = Number(body.attendee_count);
  }
  if (!partial) {
    if (!data.project_id) errors.push("project_id is required");
    if (!data.title) errors.push("title is required");
    if (!data.starts_at) errors.push("starts_at is required");
    if (!data.ends_at) errors.push("ends_at is required");
    if (!data.lead_id && !data.opportunity_id)
      errors.push("lead_id or opportunity_id is required");
  } else if (!Object.keys(body).length)
    errors.push("At least one field is required");
  return errors.length ? { ok: false, errors } : { ok: true, data };
}

export async function getSiteVisit(
  db: Queryable,
  visitId: string,
  lock = false,
) {
  const result = await db.query(
    `SELECT ${SITE_VISIT_COLUMNS} FROM appointments ap JOIN site_visits sv ON sv.visit_id=ap.appointment_id
     WHERE ap.appointment_id=$1 AND ap.appointment_type='site_visit'${lock ? " FOR UPDATE OF ap,sv" : ""}`,
    [visitId],
  );
  return result.rows[0] ?? null;
}

export async function addSiteVisitHistory(
  db: Queryable,
  visitId: string,
  action: string,
  fromStatus: string | null,
  toStatus: string,
  performedBy: string | null,
  metadata: Record<string, unknown> = {},
  previousStartsAt: unknown = null,
  previousEndsAt: unknown = null,
) {
  await db.query(
    `INSERT INTO site_visit_state_history (visit_id, action, from_status, to_status,
     previous_starts_at, previous_ends_at, metadata, performed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      visitId,
      action,
      fromStatus,
      toStatus,
      previousStartsAt,
      previousEndsAt,
      metadata,
      performedBy,
    ],
  );
}

export type ParticipantInput = {
  participant_type: "user" | "contact" | "external";
  user_id?: string;
  contact_id?: string;
  external_name?: string;
  external_email?: string | null;
  external_phone?: string | null;
  participant_role?:
    "organizer" | "host" | "attendee" | "decision_maker" | "family" | "broker";
  attendance_status?:
    "expected" | "confirmed" | "attended" | "absent" | "cancelled";
};

export function validateParticipants(
  body: unknown,
): ValidationResult<ParticipantInput[]> {
  if (
    !isObject(body) ||
    Array.isArray(body) ||
    !Array.isArray(body.participants)
  )
    return { ok: false, errors: ["participants must be an array"] };
  const errors: string[] = [];
  const participants: ParticipantInput[] = [];
  body.participants.forEach((item, index) => {
    if (!isObject(item) || Array.isArray(item)) {
      errors.push(`participants[${index}] must be an object`);
      return;
    }
    const prefix = `participants[${index}]`;
    const type = String(item.participant_type ?? "");
    if (!["user", "contact", "external"].includes(type)) {
      errors.push(
        `${prefix}.participant_type must be user, contact, or external`,
      );
      return;
    }
    const local: string[] = [];
    const userId = uuid(item.user_id, `${prefix}.user_id`, local);
    const contactId = uuid(item.contact_id, `${prefix}.contact_id`, local);
    const name = validateText(
      item.external_name,
      `${prefix}.external_name`,
      200,
      false,
      local,
    );
    const email = validateText(
      item.external_email,
      `${prefix}.external_email`,
      255,
      true,
      local,
    );
    const phone = validateText(
      item.external_phone,
      `${prefix}.external_phone`,
      30,
      true,
      local,
    );
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      local.push(`${prefix}.external_email must be a valid email address`);
    const role = String(item.participant_role ?? "attendee");
    const attendance = String(item.attendance_status ?? "expected");
    if (
      ![
        "organizer",
        "host",
        "attendee",
        "decision_maker",
        "family",
        "broker",
      ].includes(role)
    )
      local.push(`${prefix}.participant_role is invalid`);
    if (
      !["expected", "confirmed", "attended", "absent", "cancelled"].includes(
        attendance,
      )
    )
      local.push(`${prefix}.attendance_status is invalid`);
    if (type === "user" && !userId) local.push(`${prefix}.user_id is required`);
    if (type === "contact" && !contactId)
      local.push(`${prefix}.contact_id is required`);
    if (type === "external" && !name)
      local.push(`${prefix}.external_name is required`);
    errors.push(...local);
    participants.push({
      participant_type: type as ParticipantInput["participant_type"],
      user_id: type === "user" ? (userId ?? undefined) : undefined,
      contact_id: type === "contact" ? (contactId ?? undefined) : undefined,
      external_name: type === "external" ? (name ?? undefined) : undefined,
      external_email: email,
      external_phone: phone,
      participant_role: role as ParticipantInput["participant_role"],
      attendance_status: attendance as ParticipantInput["attendance_status"],
    });
  });
  const userIds = participants.flatMap((participant) =>
    participant.user_id ? [participant.user_id] : [],
  );
  const contactIds = participants.flatMap((participant) =>
    participant.contact_id ? [participant.contact_id] : [],
  );
  if (new Set(userIds).size !== userIds.length)
    errors.push("participants cannot contain duplicate user_id values");
  if (new Set(contactIds).size !== contactIds.length)
    errors.push("participants cannot contain duplicate contact_id values");
  return errors.length
    ? { ok: false, errors }
    : { ok: true, data: participants };
}

export type UnitShownInput = {
  unit_id: string;
  display_order: number;
  interest_level?: "low" | "medium" | "high" | "selected" | null;
  notes?: string | null;
};
export function validateUnitsShown(
  body: unknown,
): ValidationResult<UnitShownInput[]> {
  if (!isObject(body) || Array.isArray(body) || !Array.isArray(body.units))
    return { ok: false, errors: ["units must be an array"] };
  const errors: string[] = [];
  const units: UnitShownInput[] = [];
  body.units.forEach((item, index) => {
    if (!isObject(item) || Array.isArray(item)) {
      errors.push(`units[${index}] must be an object`);
      return;
    }
    const id = uuid(item.unit_id, `units[${index}].unit_id`, errors);
    const order = positiveInteger(
      item.display_order ?? index + 1,
      `units[${index}].display_order`,
      errors,
    );
    const interest =
      item.interest_level === null
        ? null
        : item.interest_level === undefined
          ? undefined
          : String(item.interest_level);
    if (
      interest !== undefined &&
      interest !== null &&
      !["low", "medium", "high", "selected"].includes(interest)
    )
      errors.push(`units[${index}].interest_level is invalid`);
    const notes = validateText(
      item.notes,
      `units[${index}].notes`,
      5000,
      true,
      errors,
    );
    if (id && typeof order === "number")
      units.push({
        unit_id: id,
        display_order: order,
        interest_level: interest as UnitShownInput["interest_level"],
        notes,
      });
  });
  if (new Set(units.map((unit) => unit.unit_id)).size !== units.length)
    errors.push("units cannot contain duplicate unit_id values");
  if (new Set(units.map((unit) => unit.display_order)).size !== units.length)
    errors.push("units cannot contain duplicate display_order values");
  return errors.length ? { ok: false, errors } : { ok: true, data: units };
}
