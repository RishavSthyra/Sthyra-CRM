import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  hasPricingComponents,
  pricingComponentsTotal,
  pricingComponentsValue,
  totalPrice,
} from "../lib/inventoryPricing";

const components = {
  "Infrastructure Charges @ Rs.649/sft.": 1_917_795,
  "Preferential Location Charges (PLC) Extra": 738_750,
  "Extar plot area (PLA) Extra": 0,
};

test("inventory template pricing totals additive charges without GST", () => {
  assert.equal(pricingComponentsTotal(components), 2_656_545);
  assert.equal(totalPrice(26_595_000, components), 29_251_545);
  assert.equal(hasPricingComponents(components), true);
  assert.equal(hasPricingComponents({}), false);
});

test("inventory template pricing accepts only non-negative named amounts", () => {
  const validErrors: string[] = [];
  assert.deepEqual(pricingComponentsValue(components, validErrors), components);
  assert.deepEqual(validErrors, []);

  const invalidErrors: string[] = [];
  assert.deepEqual(
    pricingComponentsValue(
      { "": 100, Discount: -1, Notes: "invalid" },
      invalidErrors,
    ),
    {},
  );
  assert.equal(invalidErrors.length, 3);
});

test("unit template API and UI expose data-driven pricing components", () => {
  const createRoute = readFileSync(
    "app/api/inventory/unit-types/route.ts",
    "utf8",
  );
  const updateRoute = readFileSync(
    "app/api/inventory/unit-types/[unittypeid]/route.ts",
    "utf8",
  );
  for (const source of [createRoute, updateRoute]) {
    assert.match(source, /pricing_components/);
    assert.match(source, /pricingComponentsValue/);
    assert.match(source, /syncUnitTypeBasePrice/);
  }

  const workspace = readFileSync(
    "components/inventory/InventoryWorkspace.tsx",
    "utf8",
  );
  assert.match(workspace, /Total price without GST/);
  assert.match(workspace, /hasPricingComponents/);

  const dialogs = readFileSync(
    "components/inventory/InventoryDialogs.tsx",
    "utf8",
  );
  assert.match(dialogs, /Infrastructure Charges @ Rs\.649\/sft\./);
  assert.match(dialogs, /Preferential Location Charges \(PLC\) Extra/);
  assert.match(dialogs, /Extar plot area \(PLA\) Extra/);
  assert.match(dialogs, /GST is added separately/);
});
