import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentActionTimingError,
  appointmentScheduleError,
  calendarEventDurationMinutes,
  getAppointmentTiming,
} from "../lib/appointmentTiming";

const startsAt = "2026-10-06T10:00:00.000Z";
const endsAt = "2026-10-06T11:00:00.000Z";

test("site-visit check-in opens exactly one hour before the appointment", () => {
  assert.equal(
    getAppointmentTiming(startsAt, endsAt, "2026-10-06T08:59:59.999Z")
      .canCheckIn,
    false,
  );
  assert.equal(
    getAppointmentTiming(startsAt, endsAt, "2026-10-06T09:00:00.000Z")
      .canCheckIn,
    true,
  );
});

test("appointment completion is only available during its scheduled window", () => {
  assert.equal(
    getAppointmentTiming(startsAt, endsAt, "2026-10-06T09:59:59.999Z")
      .canComplete,
    false,
  );
  assert.equal(
    getAppointmentTiming(startsAt, endsAt, "2026-10-06T10:30:00.000Z")
      .canComplete,
    true,
  );
  assert.equal(
    getAppointmentTiming(startsAt, endsAt, "2026-10-06T11:00:00.001Z")
      .canComplete,
    false,
  );
});

test("appointment becomes overdue only after its end time", () => {
  assert.equal(
    getAppointmentTiming(startsAt, endsAt, "2026-10-06T10:30:00.000Z")
      .isOverdue,
    false,
  );
  assert.equal(
    getAppointmentTiming(startsAt, endsAt, "2026-10-06T11:00:00.001Z")
      .isOverdue,
    true,
  );
  assert.equal(
    appointmentActionTimingError(
      "no-show",
      startsAt,
      endsAt,
      "2026-10-06T10:30:00.000Z",
    ),
    "A site visit cannot be marked as no-show before it ends",
  );
});

test("appointments cannot be created or rescheduled into the past", () => {
  assert.equal(
    appointmentScheduleError(
      "2026-10-12T09:59:59.999Z",
      "2026-10-12T11:00:00.000Z",
      "2026-10-12T10:00:00.000Z",
    ),
    "Start time must be in the future",
  );
  assert.equal(
    appointmentScheduleError(
      "2026-10-12T10:30:00.000Z",
      "2026-10-12T11:30:00.000Z",
      "2026-10-12T10:00:00.000Z",
    ),
    null,
  );
});

test("appointments reject accidental multi-day durations", () => {
  assert.equal(
    appointmentScheduleError(
      "2026-10-13T10:00:00.000Z",
      "2026-10-14T11:00:00.000Z",
      "2026-10-12T10:00:00.000Z",
    ),
    "Appointments cannot be longer than 12 hours",
  );
});

test("oversized legacy events cannot consume the full calendar grid", () => {
  assert.equal(calendarEventDurationMinutes(startsAt, endsAt), 60);
  assert.equal(
    calendarEventDurationMinutes(
      "2026-10-10T08:30:00.000Z",
      "2026-10-11T09:30:00.000Z",
    ),
    180,
  );
});
