import type { PoolClient } from "pg";
import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export const ACTIVITY_COLUMNS = `
  a.activity_id, a.company_id, a.project_id, a.lead_id, a.contact_id,
  a.activity_type, a.source_type, a.source_id, a.title, a.description,
  a.metadata, a.occurred_at, a.actor_user_id, a.created_at
`;

export const TASK_COLUMNS = `
  t.task_id, t.company_id, t.project_id, t.lead_id, t.contact_id,
  t.title, t.description, t.priority, t.status, t.due_at,
  t.assigned_to_user_id, t.assigned_to_team_id, t.created_by, t.updated_by,
  t.completed_at, t.completed_by, t.cancelled_at, t.cancelled_by,
  t.cancellation_reason, t.created_at, t.updated_at
`;

export const NOTE_COLUMNS = `
  n.note_id, n.company_id, n.project_id, n.lead_id, n.contact_id,
  n.title, n.body, n.visibility, n.owner_team_id, n.is_pinned,
  n.created_by, n.updated_by, n.archived_at, n.archived_by,
  n.created_at, n.updated_at
`;

export const APPOINTMENT_COLUMNS = `
  ap.appointment_id, ap.company_id, ap.project_id, ap.lead_id, ap.contact_id,
  ap.appointment_type, ap.title, ap.description, ap.location, ap.meeting_url,
  ap.starts_at, ap.ends_at, ap.timezone, ap.status, ap.organizer_user_id,
  ap.assigned_to_user_id, ap.assigned_to_team_id, ap.created_by, ap.updated_by,
  ap.confirmed_at, ap.confirmed_by, ap.completed_at, ap.completed_by,
  ap.cancelled_at, ap.cancelled_by, ap.cancellation_reason,
  ap.reschedule_reason, ap.created_at, ap.updated_at
`;

type ValidationResult<T> =
  { ok: true; data: T } | { ok: false; errors: string[] };

export class ActivityReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityReferenceError";
  }
}

export function parseActivityUuid(value: string): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

function uuid(
  value: unknown,
  field: string,
  errors: string[],
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!isUuid(value)) {
    errors.push(`${field} must be a valid UUID or null`);
    return undefined;
  }
  return value.toLowerCase();
}

function timestamp(
  value: unknown,
  field: string,
  nullable: boolean,
  errors: string[],
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && nullable) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Number.isNaN(Date.parse(value))
  ) {
    errors.push(
      `${field} must be a valid ISO date-time${nullable ? " or null" : ""}`,
    );
    return undefined;
  }
  return new Date(value).toISOString();
}

function projectId(value: unknown, errors: string[]): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    errors.push("project_id must be a positive integer");
    return undefined;
  }
  return Number(value);
}

export type TaskInput = {
  project_id?: number;
  lead_id?: string | null;
  contact_id?: string | null;
  title?: string;
  description?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
  status?: "open" | "in_progress";
  due_at?: string | null;
  assigned_to_user_id?: string | null;
  assigned_to_team_id?: string | null;
};

export function validateTaskPayload(
  body: unknown,
  partial: boolean,
): ValidationResult<TaskInput> {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const allowed = new Set([
    "project_id",
    "lead_id",
    "contact_id",
    "title",
    "description",
    "priority",
    "status",
    "due_at",
    "assigned_to_user_id",
    "assigned_to_team_id",
  ]);
  const errors = Object.keys(body)
    .filter((field) => !allowed.has(field))
    .map((field) => `Unknown field: ${field}`);
  const project = projectId(body.project_id, errors);
  const lead = uuid(body.lead_id, "lead_id", errors);
  const contact = uuid(body.contact_id, "contact_id", errors);
  const title = validateText(body.title, "title", 250, false, errors);
  const description = validateText(
    body.description,
    "description",
    10000,
    true,
    errors,
  );
  const priorities = ["low", "normal", "high", "urgent"] as const;
  let priority: TaskInput["priority"];
  if (body.priority !== undefined) {
    if (!priorities.includes(body.priority as (typeof priorities)[number])) {
      errors.push(`priority must be one of: ${priorities.join(", ")}`);
    } else priority = body.priority as TaskInput["priority"];
  }
  let status: TaskInput["status"];
  if (body.status !== undefined) {
    if (!["open", "in_progress"].includes(String(body.status))) {
      errors.push(
        "status can only be open or in_progress; use task commands for terminal states",
      );
    } else status = body.status as TaskInput["status"];
  }
  const dueAt = timestamp(body.due_at, "due_at", true, errors);
  const user = uuid(body.assigned_to_user_id, "assigned_to_user_id", errors);
  const team = uuid(body.assigned_to_team_id, "assigned_to_team_id", errors);
  if (!partial) {
    if (!project) errors.push("project_id is required");
    if (!title) errors.push("title is required");
  } else if (!Object.keys(body).length)
    errors.push("At least one field is required");
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        data: {
          project_id: project,
          lead_id: lead,
          contact_id: contact,
          title: title ?? undefined,
          description,
          priority,
          status,
          due_at: dueAt,
          assigned_to_user_id: user,
          assigned_to_team_id: team,
        },
      };
}

export type NoteInput = {
  project_id?: number;
  lead_id?: string | null;
  contact_id?: string | null;
  title?: string | null;
  body?: string;
  visibility?: "private" | "team" | "company";
  is_pinned?: boolean;
};

export function validateNotePayload(
  body: unknown,
  partial: boolean,
): ValidationResult<NoteInput> {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const allowed = new Set([
    "project_id",
    "lead_id",
    "contact_id",
    "title",
    "body",
    "visibility",
    "is_pinned",
  ]);
  const errors = Object.keys(body)
    .filter((field) => !allowed.has(field))
    .map((field) => `Unknown field: ${field}`);
  const project = projectId(body.project_id, errors);
  const lead = uuid(body.lead_id, "lead_id", errors);
  const contact = uuid(body.contact_id, "contact_id", errors);
  const title = validateText(body.title, "title", 250, true, errors);
  const noteBody = validateText(body.body, "body", 20000, false, errors);
  const visibilities = ["private", "team", "company"] as const;
  let visibility: NoteInput["visibility"];
  if (body.visibility !== undefined) {
    if (
      !visibilities.includes(body.visibility as (typeof visibilities)[number])
    ) {
      errors.push(`visibility must be one of: ${visibilities.join(", ")}`);
    } else visibility = body.visibility as NoteInput["visibility"];
  }
  let pinned: boolean | undefined;
  if (body.is_pinned !== undefined) {
    if (typeof body.is_pinned !== "boolean")
      errors.push("is_pinned must be a boolean");
    else pinned = body.is_pinned;
  }
  if (!partial) {
    if (!project) errors.push("project_id is required");
    if (!noteBody) errors.push("body is required");
  } else if (!Object.keys(body).length)
    errors.push("At least one field is required");
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        data: {
          project_id: project,
          lead_id: lead,
          contact_id: contact,
          title,
          body: noteBody ?? undefined,
          visibility,
          is_pinned: pinned,
        },
      };
}

export type AppointmentInput = {
  project_id?: number;
  lead_id?: string | null;
  contact_id?: string | null;
  appointment_type?: "call" | "meeting" | "site_visit" | "video" | "other";
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
};

export function validateAppointmentPayload(
  body: unknown,
  partial: boolean,
): ValidationResult<AppointmentInput> {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const allowed = new Set([
    "project_id",
    "lead_id",
    "contact_id",
    "appointment_type",
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
  ]);
  const errors = Object.keys(body)
    .filter((field) => !allowed.has(field))
    .map((field) => `Unknown field: ${field}`);
  const project = projectId(body.project_id, errors);
  const lead = uuid(body.lead_id, "lead_id", errors);
  const contact = uuid(body.contact_id, "contact_id", errors);
  const types = ["call", "meeting", "site_visit", "video", "other"] as const;
  let appointmentType: AppointmentInput["appointment_type"];
  if (body.appointment_type !== undefined) {
    if (!types.includes(body.appointment_type as (typeof types)[number]))
      errors.push(`appointment_type must be one of: ${types.join(", ")}`);
    else
      appointmentType =
        body.appointment_type as AppointmentInput["appointment_type"];
  }
  const title = validateText(body.title, "title", 250, false, errors);
  const description = validateText(
    body.description,
    "description",
    10000,
    true,
    errors,
  );
  const location = validateText(body.location, "location", 500, true, errors);
  const meetingUrl = validateText(
    body.meeting_url,
    "meeting_url",
    2000,
    true,
    errors,
  );
  if (meetingUrl) {
    try {
      const parsedUrl = new URL(meetingUrl);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        errors.push("meeting_url must use http or https");
      }
    } catch {
      errors.push("meeting_url must be a valid URL");
    }
  }
  const startsAt = timestamp(body.starts_at, "starts_at", false, errors);
  const endsAt = timestamp(body.ends_at, "ends_at", false, errors);
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt))
    errors.push("ends_at must be after starts_at");
  const timezone = validateText(body.timezone, "timezone", 100, false, errors);
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      errors.push("timezone must be a valid IANA timezone");
    }
  }
  const organizer = uuid(body.organizer_user_id, "organizer_user_id", errors);
  const user = uuid(body.assigned_to_user_id, "assigned_to_user_id", errors);
  const team = uuid(body.assigned_to_team_id, "assigned_to_team_id", errors);
  if (!partial) {
    if (!project) errors.push("project_id is required");
    if (!title) errors.push("title is required");
    if (!startsAt) errors.push("starts_at is required");
    if (!endsAt) errors.push("ends_at is required");
  } else if (!Object.keys(body).length)
    errors.push("At least one field is required");
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        data: {
          project_id: project,
          lead_id: lead,
          contact_id: contact,
          appointment_type: appointmentType,
          title: title ?? undefined,
          description,
          location,
          meeting_url: meetingUrl,
          starts_at: startsAt ?? undefined,
          ends_at: endsAt ?? undefined,
          timezone: timezone ?? undefined,
          organizer_user_id: organizer,
          assigned_to_user_id: user,
          assigned_to_team_id: team,
        },
      };
}

export async function validateActivityReferences(
  client: PoolClient,
  companyId: number,
  data: {
    project_id?: number;
    lead_id?: string | null;
    contact_id?: string | null;
    assigned_to_user_id?: string | null;
    organizer_user_id?: string | null;
    assigned_to_team_id?: string | null;
  },
): Promise<void> {
  if (!data.project_id)
    throw new ActivityReferenceError("project_id is required");
  const project = await client.query(
    "SELECT 1 FROM projects WHERE project_id=$1 AND company_id=$2 AND is_active=TRUE",
    [data.project_id, companyId],
  );
  if (!project.rowCount)
    throw new ActivityReferenceError("Active company project not found");
  if (data.lead_id) {
    const lead = await client.query(
      "SELECT contact_id FROM leads WHERE lead_id=$1 AND project_id=$2",
      [data.lead_id, data.project_id],
    );
    if (!lead.rowCount)
      throw new ActivityReferenceError("Lead not found in this project");
    if (data.contact_id && lead.rows[0].contact_id !== data.contact_id) {
      throw new ActivityReferenceError(
        "contact_id does not match the lead contact",
      );
    }
  }
  if (data.contact_id) {
    const contact = await client.query(
      `SELECT 1 FROM contacts c
       WHERE c.contact_id=$1 AND c.archived_at IS NULL
         AND ($2::uuid IS NOT NULL OR EXISTS (
           SELECT 1 FROM leads l
           WHERE l.contact_id=c.contact_id AND l.project_id=$3
         ))`,
      [data.contact_id, data.lead_id ?? null, data.project_id],
    );
    if (!contact.rowCount) {
      throw new ActivityReferenceError("Active contact not found");
    }
  }
  for (const [field, value] of [
    ["assigned_to_user_id", data.assigned_to_user_id],
    ["organizer_user_id", data.organizer_user_id],
  ] as const) {
    if (!value) continue;
    const user = await client.query(
      `SELECT 1 FROM users u JOIN teams t ON t.team_id=u.team_id
       WHERE u.user_id=$1 AND t.company_id=$2 AND u.is_active=TRUE
         AND u.deleted_at IS NULL AND t.is_active=TRUE`,
      [value, companyId],
    );
    if (!user.rowCount)
      throw new ActivityReferenceError(
        `${field} must be an active company user`,
      );
  }
  if (data.assigned_to_team_id) {
    const team = await client.query(
      "SELECT 1 FROM teams WHERE team_id=$1 AND company_id=$2 AND is_active=TRUE",
      [data.assigned_to_team_id, companyId],
    );
    if (!team.rowCount)
      throw new ActivityReferenceError(
        "assigned_to_team_id must be an active company team",
      );
  }
}

export async function recordActivity(
  client: PoolClient,
  entity: Record<string, unknown>,
  sourceType: "task" | "note" | "appointment",
  activityType: string,
  title: string,
  actorUserId: string,
  options: {
    description?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await client.query(
    `INSERT INTO activities (
       company_id, project_id, lead_id, contact_id, activity_type,
       source_type, source_id, title, description, metadata, actor_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
    [
      entity.company_id,
      entity.project_id,
      entity.lead_id ?? null,
      entity.contact_id ?? null,
      activityType,
      sourceType,
      entity[`${sourceType}_id`],
      title,
      options.description ?? null,
      JSON.stringify(options.metadata ?? {}),
      actorUserId,
    ],
  );
}
