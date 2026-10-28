const DEFAULT_TASK_TIMEZONE = "Asia/Kolkata";

function calendarDateKey(value: string | Date, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function taskScheduleError(
  startsAt: string | null | undefined,
  dueAt: string | null | undefined,
  now: string | Date = new Date(),
  timeZone = DEFAULT_TASK_TIMEZONE,
): string | null {
  const today = calendarDateKey(now, timeZone);
  const startDate = startsAt ? calendarDateKey(startsAt, timeZone) : null;
  const dueDate = dueAt ? calendarDateKey(dueAt, timeZone) : null;

  if (startDate && startDate < today) {
    return "Start date cannot be in the past";
  }
  if (dueDate && dueDate < today) {
    return "Due date cannot be in the past";
  }
  if (startDate && dueDate && dueDate < startDate) {
    return "Due date cannot be earlier than the start date";
  }
  return null;
}
