import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

type AvailabilityWindow = {
  start: string;
  end: string;
};

type WeeklySchedule = Partial<
  Record<(typeof DAYS)[number], AvailabilityWindow[]>
>;

export type AvailabilityWrite = Partial<{
  timezone: string;
  weekly_schedule: WeeklySchedule;
  is_available: boolean;
}>;

type ValidationResult =
  | { ok: true; data: AvailabilityWrite }
  | { ok: false; errors: string[] };

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function validateWeeklySchedule(
  value: unknown,
  errors: string[],
): WeeklySchedule | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value) || Array.isArray(value)) {
    errors.push("weekly_schedule must be a JSON object");
    return undefined;
  }

  const validDays = new Set<string>(DAYS);
  Object.keys(value)
    .filter((day) => !validDays.has(day))
    .forEach((day) => errors.push(`Unknown weekly_schedule day: ${day}`));

  const schedule: WeeklySchedule = {};
  for (const day of DAYS) {
    const windows = value[day];
    if (windows === undefined) {
      continue;
    }
    if (!Array.isArray(windows)) {
      errors.push(`weekly_schedule.${day} must be an array`);
      continue;
    }

    const normalizedWindows: AvailabilityWindow[] = [];
    windows.forEach((window, index) => {
      if (!isObject(window) || Array.isArray(window)) {
        errors.push(`weekly_schedule.${day}[${index}] must be an object`);
        return;
      }
      const unknownFields = Object.keys(window).filter(
        (field) => field !== "start" && field !== "end",
      );
      unknownFields.forEach((field) =>
        errors.push(`Unknown weekly_schedule.${day}[${index}] field: ${field}`),
      );

      const { start, end } = window;
      if (typeof start !== "string" || !TIME_PATTERN.test(start)) {
        errors.push(`weekly_schedule.${day}[${index}].start must use HH:MM`);
      }
      if (typeof end !== "string" || !TIME_PATTERN.test(end)) {
        errors.push(`weekly_schedule.${day}[${index}].end must use HH:MM`);
      }
      if (
        typeof start === "string" &&
        typeof end === "string" &&
        TIME_PATTERN.test(start) &&
        TIME_PATTERN.test(end)
      ) {
        if (start >= end) {
          errors.push(
            `weekly_schedule.${day}[${index}].end must be after start`,
          );
        } else {
          normalizedWindows.push({ start, end });
        }
      }
    });

    const sortedWindows = [...normalizedWindows].sort((a, b) =>
      a.start.localeCompare(b.start),
    );
    for (let index = 1; index < sortedWindows.length; index += 1) {
      if (sortedWindows[index].start < sortedWindows[index - 1].end) {
        errors.push(`weekly_schedule.${day} contains overlapping windows`);
        break;
      }
    }
    schedule[day] = sortedWindows;
  }

  return schedule;
}

export function validateAvailabilityPayload(body: unknown): ValidationResult {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const allowedFields = new Set([
    "timezone",
    "weekly_schedule",
    "is_available",
  ]);
  const errors = Object.keys(body)
    .filter((field) => !allowedFields.has(field))
    .map((field) => `Unknown field: ${field}`);
  const data: AvailabilityWrite = {};

  const timezone = validateText(body.timezone, "timezone", 100, false, errors);
  if (typeof timezone === "string") {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      data.timezone = timezone;
    } catch {
      errors.push("timezone must be a valid IANA timezone");
    }
  }

  const weeklySchedule = validateWeeklySchedule(body.weekly_schedule, errors);
  if (weeklySchedule !== undefined) {
    data.weekly_schedule = weeklySchedule;
  }

  if (body.is_available !== undefined) {
    if (typeof body.is_available !== "boolean") {
      errors.push("is_available must be a boolean");
    } else {
      data.is_available = body.is_available;
    }
  }

  if (Object.keys(body).length === 0) {
    errors.push("At least one field is required");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, data };
}
