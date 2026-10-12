import assert from "node:assert/strict";
import test from "node:test";
import {
  getInventoryAssetTerminology,
  getInventoryTemplateAreaSqft,
  inferInventoryRoomType,
  validateInventoryLayout,
} from "../lib/inventoryLayouts";

test("inventory asset labels follow the selected asset type", () => {
  assert.deepEqual(getInventoryAssetTerminology({ asset_type_key: "villa" }), {
    singular: "villa",
    plural: "villas",
    title: "Villa",
  });
  assert.deepEqual(
    getInventoryAssetTerminology({ asset_type_key: "parking" }),
    {
      singular: "parking space",
      plural: "parking spaces",
      title: "Parking space",
    },
  );
  assert.deepEqual(
    getInventoryAssetTerminology({
      asset_type_key: "farm_house",
      asset_type_name: "Farm house",
    }),
    { singular: "farm house", plural: "farm houses", title: "Farm house" },
  );
});

test("inventory units inherit the most useful area from their template", () => {
  assert.equal(
    getInventoryTemplateAreaSqft({
      saleable_area_sqft: "1450",
      built_up_area_sqft: 1320,
      carpet_area_sqft: 1080,
    }),
    1450,
  );
  assert.equal(
    getInventoryTemplateAreaSqft({
      saleable_area_sqft: null,
      built_up_area_sqft: 1320,
      carpet_area_sqft: 1080,
    }),
    1320,
  );
  assert.equal(
    getInventoryTemplateAreaSqft({
      saleable_area_sqft: null,
      built_up_area_sqft: null,
      carpet_area_sqft: 1080,
    }),
    1080,
  );
});

test("inventory layouts infer internal room categories from the room name", () => {
  assert.equal(inferInventoryRoomType("Master Bedroom"), "Bedroom");
  assert.equal(inferInventoryRoomType("Dining Room"), "Dining");
  assert.equal(inferInventoryRoomType("Walk-in wardrobe"), null);
});

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
  if (result.ok) {
    assert.equal(result.data.rooms[0].area_sqft, 129.17);
    assert.equal(result.data.rooms[0].room_type, "Kitchen");
  }
});

test("inventory layouts reject incomplete dimensions and unsafe asset URLs", () => {
  const result = validateInventoryLayout({
    rooms: [{ room_name: "Bedroom", length: 10, measurement_unit: "ft" }],
    assets: [{ asset_url: "javascript:alert(1)" }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.errors.some((error) => error.includes("provided together")),
    );
    assert.ok(result.errors.some((error) => error.includes("http or https")));
  }
});
