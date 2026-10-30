import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROJECT_OPPORTUNITY_STAGES } from "../lib/defaultOpportunityStages";
import { closingProbability } from "../lib/opportunityWorkflow";

test("site visit precedes shortlisting in the default deal journey", () => {
  const keys = DEFAULT_PROJECT_OPPORTUNITY_STAGES.map(
    (stage) => stage.stage_key,
  );
  assert.deepEqual(keys, [
    "discovery",
    "site_visit",
    "shortlisting",
    "proposal",
    "negotiation",
    "booking",
  ]);

  const probabilities = DEFAULT_PROJECT_OPPORTUNITY_STAGES.map(
    (stage) => stage.probability,
  );
  assert.deepEqual(probabilities, [25, 40, 55, 70, 82, 92]);
});

test("won opportunities close at full probability", () => {
  assert.equal(closingProbability("won"), 100);
});

test("lost opportunities close at zero probability", () => {
  assert.equal(closingProbability("lost"), 0);
});
