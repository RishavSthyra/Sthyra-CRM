import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ATTENTION_ELIGIBLE_LEAD_STATUSES,
  followUpDigestEventKey,
  getLeadAttentionBucket,
} from "../lib/leadAttention";

test("lead attention uses local calendar days and includes overdue work today", () => {
  const now = new Date("2026-10-31T14:30:00.000Z"); // 20:00 in India
  assert.equal(
    getLeadAttentionBucket("2026-10-30T05:00:00.000Z", now, "Asia/Kolkata"),
    "today",
  );
  assert.equal(
    getLeadAttentionBucket("2026-11-01T05:00:00.000Z", now, "Asia/Kolkata"),
    "upcoming",
  );
  assert.equal(
    getLeadAttentionBucket("2026-11-02T05:00:00.000Z", now, "Asia/Kolkata"),
    "upcoming",
  );
  assert.equal(
    getLeadAttentionBucket("2026-11-03T05:00:00.000Z", now, "Asia/Kolkata"),
    "later",
  );
});

test("attention boundaries remain stable across year and timezone boundaries", () => {
  const now = new Date("2026-12-31T22:30:00.000Z");
  assert.equal(
    getLeadAttentionBucket("2026-12-31T23:00:00.000Z", now, "America/New_York"),
    "today",
  );
  assert.equal(
    getLeadAttentionBucket("2027-01-01T08:00:00.000Z", now, "America/New_York"),
    "upcoming",
  );
  assert.equal(
    getLeadAttentionBucket("2027-01-03T08:00:00.000Z", now, "America/New_York"),
    "later",
  );
});

test("50,000 follow-ups can be bucketed without invalid results", () => {
  const now = new Date("2026-10-31T12:00:00.000Z");
  const timezones = [
    "Asia/Kolkata",
    "America/New_York",
    "Europe/London",
    "Pacific/Auckland",
  ];
  const counts = { today: 0, upcoming: 0, later: 0 };
  for (let index = 0; index < 50_000; index += 1) {
    const due = new Date(now.getTime() + (index % 240 - 72) * 60 * 60 * 1000);
    counts[
      getLeadAttentionBucket(due, now, timezones[index % timezones.length])
    ] += 1;
  }
  assert.equal(counts.today + counts.upcoming + counts.later, 50_000);
  assert.ok(counts.today > 0);
  assert.ok(counts.upcoming > 0);
  assert.ok(counts.later > 0);
});

test("calendar and digest retain one lead-next-action source of truth", () => {
  const calendarRoute = readFileSync(
    new URL("../app/api/calendar/follow-ups/route.ts", import.meta.url),
    "utf8",
  );
  const calendarClient = readFileSync(
    new URL("../components/calendar/CalendarWorkspace.tsx", import.meta.url),
    "utf8",
  );
  const jobRoute = readFileSync(
    new URL("../app/api/notification-jobs/process/route.ts", import.meta.url),
    "utf8",
  );
  const leadsPage = readFileSync(
    new URL("../app/leads/page.tsx", import.meta.url),
    "utf8",
  );

  assert.deepEqual(ATTENTION_ELIGIBLE_LEAD_STATUSES, [
    "active",
    "nurture",
    "qualified",
  ]);
  assert.match(calendarRoute, /lead_next_actions/);
  assert.match(calendarRoute, /lead\.current_owner_user_id=\$/);
  assert.match(calendarClient, /Promise\.all\(\[/);
  assert.match(calendarClient, /\/next-action/);
  assert.match(jobRoute, /follow_up\.daily_digest/);
  assert.match(jobRoute, /AT TIME ZONE/);
  assert.match(leadsPage, /Needs attention today/);
  assert.doesNotMatch(leadsPage, /<span>Unassigned<\/span>/);
});

test("daily digest keys are deterministic for database idempotency", () => {
  assert.equal(
    followUpDigestEventKey("2026-10-31"),
    "follow-up-digest:2026-10-31",
  );
});
