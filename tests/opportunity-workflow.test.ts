import assert from "node:assert/strict";
import test from "node:test";
import { closingProbability } from "../lib/opportunityWorkflow";

test("won opportunities close at full probability", () => {
  assert.equal(closingProbability("won"), 100);
});

test("lost opportunities close at zero probability", () => {
  assert.equal(closingProbability("lost"), 0);
});
