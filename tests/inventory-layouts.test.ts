import assert from "node:assert/strict";
import test from "node:test";
import { validateInventoryLayout } from "../lib/inventoryLayouts";

test("inventory layouts calculate room area from feet", () => {
  const result = validateInventoryLayout({
    notes: "Standard Type A layout",
    rooms: [
      {
        room_name: "Primary bedroom",
        room_type: "Bedroom",
        length: 12,
        width: 10,
        measurement_unit: "ft",
      },
    ],
    assets: [
      {
        asset_kind: "floor_plan",
        asset_url: "https://cdn.example.com/type-a.pdf",
      },
    ],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.rooms[0].area_sqft, 120);
    assert.equal(result.data.assets[0].asset_kind, "floor_plan");
  }
});

test("inventory layouts convert metric room dimensions to square feet", () => {
  const result = validateInventoryLayout({
    rooms: [
      {
        room_name: "Kitchen",
        length: 3,
        width: 4,
        measurement_unit: "m",
      },
    ],
    assets: [],
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.rooms[0].area_sqft, 129.17);
});

test("inventory layouts reject incomplete dimensions and unsafe asset URLs", () => {
  const result = validateInventoryLayout({
    rooms: [{ room_name: "Bedroom", length: 10, measurement_unit: "ft" }],
    assets: [{ asset_url: "javascript:alert(1)" }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes("provided together")));
    assert.ok(result.errors.some((error) => error.includes("http or https")));
  }
});
