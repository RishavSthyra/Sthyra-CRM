import assert from "node:assert/strict";
import test from "node:test";
import { generateCodeFromName } from "../utils/generateCodeFromName";

test("record codes are generated deterministically from display names", () => {
  assert.equal(generateCodeFromName("Nykaa Homes"), "NYKAA_HOMES");
  assert.equal(generateCodeFromName("  North / East -- Zone  "), "NORTH_EAST_ZONE");
  assert.equal(generateCodeFromName("Bengalúru"), "BENGALURU");
});

test("generated record codes respect the database length limit", () => {
  const code = generateCodeFromName("A very long project name for launch");
  assert.equal(code, "A_VERY_LONG_PROJECT");
  assert.equal(code.length, 19);
});
