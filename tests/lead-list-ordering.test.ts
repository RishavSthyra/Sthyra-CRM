import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeadListOrderBy,
  shouldPrioritizeLeadFollowUps,
} from "../lib/leadListOrdering";

const newest = "l.created_at DESC, l.lead_id DESC";

test("All leads keeps the selected sort without follow-up promotion", () => {
  assert.equal(shouldPrioritizeLeadFollowUps(null), false);
  assert.equal(buildLeadListOrderBy(null, newest), newest);
});

test("New leads stays newest-first without promoting old follow-ups", () => {
  assert.equal(shouldPrioritizeLeadFollowUps("new"), false);
  assert.equal(buildLeadListOrderBy("new", newest), newest);
});

test("worked stage queues promote due calls before their selected sort", () => {
  const orderBy = buildLeadListOrderBy("contacted", newest);
  assert.match(orderBy, /next_action\.due_at <= CURRENT_TIMESTAMP/);
  assert.ok(orderBy.endsWith(newest));
});

test("qualified stage can use the same operational ordering", () => {
  assert.equal(shouldPrioritizeLeadFollowUps("qualified"), true);
});
