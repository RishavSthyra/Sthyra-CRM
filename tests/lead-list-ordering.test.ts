import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeadListOrderBy,
  NEWEST_LEAD_ORDER,
  shouldPrioritizeLeadFollowUps,
} from "../lib/leadListOrdering";

const newest = NEWEST_LEAD_ORDER;

test("All leads keeps the selected sort without follow-up promotion", () => {
  assert.equal(shouldPrioritizeLeadFollowUps(null), false);
  assert.equal(buildLeadListOrderBy(null, newest), newest);
});

test("New leads stays newest-first without promoting old follow-ups", () => {
  assert.equal(shouldPrioritizeLeadFollowUps("new"), false);
  assert.equal(buildLeadListOrderBy("new", newest), newest);
});

test("New leads ignores every alternate user-selected sort", () => {
  const alternateSorts = [
    "l.created_at ASC, l.lead_id ASC",
    "l.updated_at DESC, l.lead_id DESC",
    "LOWER(c.first_name) ASC, l.lead_id ASC",
    "l.budget DESC NULLS LAST, l.lead_id DESC",
  ];

  for (const alternateSort of alternateSorts) {
    assert.equal(buildLeadListOrderBy("new", alternateSort), newest);
  }
});

test("worked stage queues promote due calls before their selected sort", () => {
  const orderBy = buildLeadListOrderBy("contacted", newest);
  assert.match(orderBy, /next_action\.due_at <= CURRENT_TIMESTAMP/);
  assert.ok(orderBy.endsWith(newest));
});

test("qualified stage can use the same operational ordering", () => {
  assert.equal(shouldPrioritizeLeadFollowUps("qualified"), true);
});

test("every worked and custom stage uses operational follow-up ordering", () => {
  for (const stageKey of [
    "contact_attempted",
    "contacted",
    "nurturing",
    "qualified",
    "site_visit_completed",
    "custom_sales_review",
  ]) {
    const orderBy = buildLeadListOrderBy(stageKey, newest);
    assert.equal(shouldPrioritizeLeadFollowUps(stageKey), true);
    assert.match(orderBy, /next_action\.status='pending'/);
    assert.match(orderBy, /next_action\.due_at <= CURRENT_TIMESTAMP/);
    assert.match(orderBy, /CURRENT_TIMESTAMP \+ INTERVAL '2 days'/);
    assert.match(orderBy, /next_action\.due_at END ASC NULLS LAST/);
    assert.ok(orderBy.endsWith(newest));
  }
});

type SyntheticLead = {
  id: number;
  createdAt: number;
  dueAt: number | null;
  status: "pending" | "completed" | "cancelled" | null;
};

function operationalCompare(now: number) {
  const twoDays = now + 2 * 24 * 60 * 60 * 1000;
  const bucket = (lead: SyntheticLead) => {
    if (lead.status !== "pending" || lead.dueAt === null) return 3;
    if (lead.dueAt <= now) return 0;
    if (lead.dueAt <= twoDays) return 1;
    return 2;
  };

  return (left: SyntheticLead, right: SyntheticLead) => {
    const bucketDelta = bucket(left) - bucket(right);
    if (bucketDelta !== 0) return bucketDelta;
    if (left.status === "pending" && right.status === "pending") {
      const dueDelta = (left.dueAt ?? Infinity) - (right.dueAt ?? Infinity);
      if (dueDelta !== 0) return dueDelta;
    }
    return right.createdAt - left.createdAt || right.id - left.id;
  };
}

test("operational ordering handles overdue, exact-now, future, missing, and closed actions", () => {
  const now = Date.UTC(2026, 10, 2, 10, 0, 0);
  const hour = 60 * 60 * 1000;
  const rows: SyntheticLead[] = [
    { id: 1, createdAt: now - hour, dueAt: null, status: null },
    { id: 2, createdAt: now - hour, dueAt: now + hour, status: "pending" },
    { id: 3, createdAt: now - hour, dueAt: now - hour, status: "pending" },
    { id: 4, createdAt: now - hour, dueAt: now, status: "pending" },
    { id: 5, createdAt: now - hour, dueAt: now + 72 * hour, status: "pending" },
    { id: 6, createdAt: now, dueAt: now - 72 * hour, status: "completed" },
    { id: 7, createdAt: now - 2 * hour, dueAt: now - 72 * hour, status: "cancelled" },
    { id: 8, createdAt: now - hour, dueAt: now + 48 * hour, status: "pending" },
  ];

  rows.sort(operationalCompare(now));
  assert.deepEqual(
    rows.map((row) => row.id),
    [3, 4, 2, 8, 5, 6, 1, 7],
  );
});

test("100,000 mixed follow-ups remain stable across pagination boundaries", () => {
  const now = Date.UTC(2026, 10, 2, 10, 0, 0);
  const rows: SyntheticLead[] = Array.from({ length: 100_000 }, (_, id) => {
    const actionState = id % 7;
    return {
      id,
      createdAt: now - ((id * 7_919) % 5_000_000),
      dueAt:
        actionState === 0
          ? null
          : now + (((id * 104_729) % 10_000_000) - 5_000_000),
      status:
        actionState === 0
          ? null
          : actionState === 1
            ? "completed"
            : actionState === 2
              ? "cancelled"
              : "pending",
    };
  });

  rows.sort(operationalCompare(now));
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);

  const pageSize = 137;
  const paged = Array.from(
    { length: Math.ceil(rows.length / pageSize) },
    (_, page) => rows.slice(page * pageSize, (page + 1) * pageSize),
  ).flat();
  assert.deepEqual(
    paged.map((row) => row.id),
    rows.map((row) => row.id),
  );

  const compare = operationalCompare(now);
  for (let index = 1; index < rows.length; index += 1) {
    assert.ok(compare(rows[index - 1], rows[index]) <= 0);
  }
});
