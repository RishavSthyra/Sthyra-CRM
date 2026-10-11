import assert from "node:assert/strict";
import test from "node:test";
import {
  DEAD_LEADS_TAB_KEY,
  getLeadListView,
  getLeadStatusLabel,
  isDeadLeadStatus,
} from "../lib/leadListViews";

test("lead tabs keep all, pipeline stages, and dead leads distinct", () => {
  assert.deepEqual(getLeadListView("all"), {});
  assert.deepEqual(getLeadListView("new"), { stageKey: "new" });
  assert.deepEqual(getLeadListView(DEAD_LEADS_TAB_KEY), { view: "dead" });
});

test("closed, duplicate, and invalid leads are dead leads", () => {
  assert.equal(isDeadLeadStatus("closed"), true);
  assert.equal(isDeadLeadStatus("duplicate"), true);
  assert.equal(isDeadLeadStatus("invalid"), true);
  assert.equal(isDeadLeadStatus("active"), false);
  assert.equal(isDeadLeadStatus("qualified"), false);
  assert.equal(isDeadLeadStatus("nurture"), false);
});

test("terminal status is visible instead of the old stage or temperature", () => {
  assert.equal(
    getLeadStatusLabel({
      stageName: "New",
      status: "invalid",
      temperature: "hot",
    }),
    "invalid",
  );
  assert.equal(
    getLeadStatusLabel({
      stageName: "Contacted",
      status: "active",
      temperature: "warm",
    }),
    "warm",
  );
});
