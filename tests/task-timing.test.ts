import assert from "node:assert/strict";
import test from "node:test";
import { validateTaskPayload } from "../lib/activities";
import { taskScheduleError } from "../lib/taskTiming";

const now = "2026-10-28T12:00:00.000Z";

test("tasks reject past start and due dates", () => {
  assert.equal(
    taskScheduleError("2026-10-27", "2026-10-29", now),
    "Start date cannot be in the past",
  );
  assert.equal(
    taskScheduleError("2026-10-28", "2026-10-27", now),
    "Due date cannot be in the past",
  );
});

test("tasks allow today even though a date input normalizes to midnight", () => {
  assert.equal(
    taskScheduleError(
      "2026-10-28T00:00:00.000Z",
      "2026-10-28T00:00:00.000Z",
      now,
    ),
    null,
  );
});

test("task due date cannot precede its start date", () => {
  assert.equal(
    taskScheduleError("2026-10-30", "2026-10-29", now),
    "Due date cannot be earlier than the start date",
  );
  assert.equal(taskScheduleError("2026-10-29", "2026-10-30", now), null);
});

test("task payload retains both schedule dates", () => {
  const result = validateTaskPayload(
    {
      project_id: 1,
      title: "Call the customer",
      starts_at: "2026-10-29",
      due_at: "2026-10-30",
    },
    false,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.starts_at, "2026-10-29T00:00:00.000Z");
  assert.equal(result.data.due_at, "2026-10-30T00:00:00.000Z");
});
