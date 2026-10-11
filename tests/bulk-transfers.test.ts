import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BULK_TRANSFER_LEADS,
  missingRequiredChecklistItems,
  validateBulkTransferPayload,
} from "../lib/bulkTransfers";

const leadA = "00000000-0000-4000-8000-000000000001";
const leadB = "00000000-0000-4000-8000-000000000002";
const recipient = "00000000-0000-4000-8000-000000000003";

test("bulk transfers normalize duplicate lead IDs and validate one recipient", () => {
  const result = validateBulkTransferPayload({
    project_id: 25,
    lead_ids: [leadA, leadA, leadB],
    to_owner_user_id: recipient,
    reason: "Territory handoff",
    confirmed_checklist_item_ids: [],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data.lead_ids, [leadA, leadB]);
    assert.equal(result.data.to_team_id, null);
    assert.equal(result.data.reason, "Territory handoff");
  }
});

test("bulk transfers reject single-record and oversized requests", () => {
  const single = validateBulkTransferPayload({
    project_id: 25,
    lead_ids: [leadA],
    to_owner_user_id: recipient,
    reason: "Handoff",
  });
  assert.equal(single.ok, false);
  if (!single.ok)
    assert.ok(single.errors.some((error) => error.includes("at least two")));

  const oversized = validateBulkTransferPayload({
    project_id: 25,
    lead_ids: Array.from(
      { length: MAX_BULK_TRANSFER_LEADS + 1 },
      (_, index) =>
        `00000000-0000-4000-8${String(index).padStart(3, "0")}-${String(index).padStart(12, "0")}`,
    ),
    to_owner_user_id: recipient,
    reason: "Handoff",
  });
  assert.equal(oversized.ok, false);
  if (!oversized.ok)
    assert.ok(oversized.errors.some((error) => error.includes("at most")));
});

test("bulk transfers require a reason and exactly one recipient", () => {
  const result = validateBulkTransferPayload({
    project_id: 25,
    lead_ids: [leadA, leadB],
    to_owner_user_id: recipient,
    to_team_id: "00000000-0000-4000-8000-000000000004",
    reason: " ",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.includes("Exactly one transfer recipient is required"));
    assert.ok(result.errors.includes("reason is required"));
  }
});

test("required checklist confirmations are calculated deterministically", () => {
  assert.deepEqual(
    missingRequiredChecklistItems([leadA, leadB], [leadB]),
    [leadA],
  );
});
