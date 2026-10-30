import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { numberValue } from "../lib/inventory";
import { normalizeInventoryAttributeKey } from "../lib/inventoryAttributeKeys";

test("inventory custom-field keys are generated from their labels", () => {
  assert.equal(normalizeInventoryAttributeKey("Garden Area"), "garden_area");
  assert.equal(
    normalizeInventoryAttributeKey("  Private Terrace (sq ft)  "),
    "private_terrace_sq_ft",
  );
  assert.equal(normalizeInventoryAttributeKey("___"), "");
});

test("inventory area fields accept omitted values", () => {
  const errors: string[] = [];
  for (const field of [
    "carpet_area_sqft",
    "built_up_area_sqft",
    "saleable_area_sqft",
  ]) {
    assert.equal(
      numberValue(null, field, errors, { nullable: true, minimum: 0.01 }),
      null,
    );
  }
  assert.deepEqual(errors, []);
});

test("inventory attribute APIs serialize options as JSON arrays", () => {
  const createRoute = readFileSync(
    "app/api/inventory/attributes/route.ts",
    "utf8",
  );
  const updateRoute = readFileSync(
    "app/api/inventory/attributes/[attributeid]/route.ts",
    "utf8",
  );
  for (const source of [createRoute, updateRoute]) {
    assert.match(source, /JSON\.stringify\(options|JSON\.stringify\(value/);
    assert.match(source, /::jsonb/);
  }
});

test("inventory template UI marks every area field optional and labels UDS correctly", () => {
  const dialogs = readFileSync(
    "components/inventory/InventoryDialogs.tsx",
    "utf8",
  );
  for (const field of [
    "carpet_area_sqft",
    "built_up_area_sqft",
    "saleable_area_sqft",
  ]) {
    assert.match(dialogs, new RegExp(`\\["${field}",[^\\n]+true\\]`));
  }
  assert.match(dialogs, /\["carpet_area_sqft", "UDS \(sq ft\)", true\]/);

  const manager = readFileSync(
    "components/inventory/InventoryAttributesManager.tsx",
    "utf8",
  );
  assert.match(manager, /normalizeInventoryAttributeKey\(\s*event\.target\.value/);
});
