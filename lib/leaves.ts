import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateDate } from "@/utils/validateDate";
import { validateText } from "@/utils/validateText";

export const LEAVE_COLUMNS = `
  leave_id,
  user_id,
  leave_type,
  start_date::text AS start_date,
  end_date::text AS end_date,
  reason,
  status,
  approved_by,
  approved_at,
  cancelled_at,
  created_at,
  updated_at
`;

export const LEAVE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;

const LEAVE_FIELDS = [
  "leave_type",
  "start_date",
  "end_date",
  "reason",
] as const;

export type LeaveField = (typeof LEAVE_FIELDS)[number];

export type LeaveWrite = Partial<{
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
}>;

type ValidationResult =
  | { ok: true; data: LeaveWrite }
  | { ok: false; errors: string[] };

export function validateLeavePayload(
  body: unknown,
  options: { partial: boolean },
): ValidationResult {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const allowedFields = new Set<string>(LEAVE_FIELDS);
  const errors = Object.keys(body)
    .filter((field) => !allowedFields.has(field))
    .map((field) => `Unknown field: ${field}`);
  const data: LeaveWrite = {};

  const leaveType = validateText(
    body.leave_type,
    "leave_type",
    50,
    false,
    errors,
  );
  if (typeof leaveType === "string") {
    data.leave_type = leaveType;
  }

  const startDate = validateDate(body.start_date, "start_date", errors);
  if (typeof startDate === "string") {
    data.start_date = startDate;
  }

  const endDate = validateDate(body.end_date, "end_date", errors);
  if (typeof endDate === "string") {
    data.end_date = endDate;
  }

  const reason = validateText(body.reason, "reason", 5000, true, errors);
  if (reason !== undefined) {
    data.reason = reason;
  }

  if (
    typeof startDate === "string" &&
    typeof endDate === "string" &&
    endDate < startDate
  ) {
    errors.push("end_date cannot be earlier than start_date");
  }

  if (!options.partial) {
    if (body.leave_type === undefined) {
      errors.push("leave_type is required");
    }
    if (body.start_date === undefined) {
      errors.push("start_date is required");
    }
    if (body.end_date === undefined) {
      errors.push("end_date is required");
    }
  } else if (Object.keys(body).length === 0) {
    errors.push("At least one field is required");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, data };
}

export function parseLeaveId(value: string): string | null {
  return isUuid(value) ? value : null;
}

export function isLeaveStatus(
  value: string,
): value is (typeof LEAVE_STATUSES)[number] {
  return LEAVE_STATUSES.includes(value as (typeof LEAVE_STATUSES)[number]);
}
