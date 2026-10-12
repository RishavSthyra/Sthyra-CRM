export const SITE_VISIT_CHECK_IN_EARLY_MS = 60 * 60 * 1000;
export const MAX_APPOINTMENT_DURATION_MS = 12 * 60 * 60 * 1000;
export const MAX_CALENDAR_EVENT_RENDER_MINUTES = 180;

type DateTimeValue = string | number | Date;

function timestamp(value: DateTimeValue): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function appointmentScheduleError(
  startsAt: DateTimeValue,
  endsAt: DateTimeValue,
  now: DateTimeValue = Date.now(),
): string | null {
  const startsAtMs = timestamp(startsAt);
  const endsAtMs = timestamp(endsAt);
  const nowMs = timestamp(now);
  if (
    !Number.isFinite(startsAtMs) ||
    !Number.isFinite(endsAtMs) ||
    !Number.isFinite(nowMs)
  ) {
    return "Enter a valid start and end time";
  }
  if (endsAtMs <= startsAtMs) return "End time must be after the start time";
  if (startsAtMs <= nowMs) return "Start time must be in the future";
  if (endsAtMs - startsAtMs > MAX_APPOINTMENT_DURATION_MS) {
    return "Appointments cannot be longer than 12 hours";
  }
  return null;
}

export function calendarEventDurationMinutes(
  startsAt: DateTimeValue,
  endsAt: DateTimeValue,
): number {
  const duration = (timestamp(endsAt) - timestamp(startsAt)) / 60_000;
  if (!Number.isFinite(duration) || duration <= 0) return 30;
  return Math.min(
    MAX_CALENDAR_EVENT_RENDER_MINUTES,
    Math.max(30, duration),
  );
}

export function getAppointmentTiming(
  startsAt: DateTimeValue,
  endsAt: DateTimeValue,
  now: DateTimeValue = Date.now(),
) {
  const startsAtMs = timestamp(startsAt);
  const endsAtMs = timestamp(endsAt);
  const nowMs = timestamp(now);
  const isValid =
    Number.isFinite(startsAtMs) &&
    Number.isFinite(endsAtMs) &&
    Number.isFinite(nowMs) &&
    endsAtMs > startsAtMs;
  const checkInOpensAtMs = startsAtMs - SITE_VISIT_CHECK_IN_EARLY_MS;

  return {
    isValid,
    startsAtMs,
    endsAtMs,
    checkInOpensAtMs,
    hasStarted: isValid && nowMs >= startsAtMs,
    hasEnded: isValid && nowMs > endsAtMs,
    isOverdue: isValid && nowMs > endsAtMs,
    canCheckIn:
      isValid && nowMs >= checkInOpensAtMs && nowMs <= endsAtMs,
    canComplete: isValid && nowMs >= startsAtMs && nowMs <= endsAtMs,
  };
}

export function appointmentActionTimingError(
  action: "confirm" | "check-in" | "complete" | "no-show" | "cancel",
  startsAt: DateTimeValue,
  endsAt: DateTimeValue,
  now: DateTimeValue = Date.now(),
): string | null {
  const timing = getAppointmentTiming(startsAt, endsAt, now);
  if (!timing.isValid) return "Appointment has an invalid time window";

  if (action === "check-in" && !timing.canCheckIn) {
    return timing.hasEnded
      ? "This site visit is overdue and can no longer be checked in"
      : "Check-in opens one hour before the site visit";
  }

  if (action === "complete" && !timing.canComplete) {
    return timing.hasEnded
      ? "This appointment is overdue and can no longer be completed"
      : "This appointment can only be completed after it starts";
  }

  if (action === "confirm" && timing.hasEnded) {
    return "An overdue appointment cannot be confirmed";
  }

  if (action === "no-show" && !timing.hasEnded) {
    return "A site visit cannot be marked as no-show before it ends";
  }

  return null;
}
