import assert from "node:assert/strict";
import test from "node:test";
import type { Feature, Polygon } from "geojson";
import {
  addLeadCountsToBoundaries,
  buildLeadBoundaryCounts,
  normalizeBoundaryName,
} from "../lib/leadBoundaryData";

const points = [
  { country: "India", state: "Karnataka", district: "Bengaluru Urban", leads: 4 },
  { country: "India", state: "Karnataka", district: "Mysuru", leads: 2 },
  { country: "India", state: "Delhi", district: "New Delhi", leads: 3 },
];

test("lead boundary counts aggregate each administrative level", () => {
  assert.equal(buildLeadBoundaryCounts(points, "country").get("india"), 9);
  assert.equal(buildLeadBoundaryCounts(points, "state").get("karnataka"), 6);
  assert.equal(
    buildLeadBoundaryCounts(points, "district", "Karnataka").get("bengaluru urban"),
    4,
  );
  assert.equal(buildLeadBoundaryCounts(points, "district", "Delhi").get("mysuru"), undefined);
});

test("boundary matching is case insensitive and calculates relative intensity", () => {
  const square: Polygon = {
    type: "Polygon",
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
  };
  const boundaries: Array<Feature<Polygon, { name: string }>> = [
    { type: "Feature", geometry: square, properties: { name: "Karnataka" } },
    { type: "Feature", geometry: square, properties: { name: "Delhi" } },
    { type: "Feature", geometry: square, properties: { name: "Goa" } },
  ];

  const result = addLeadCountsToBoundaries(
    boundaries,
    buildLeadBoundaryCounts(points, "state"),
  );

  assert.equal(result.features.length, 2);
  assert.equal(result.features[0].properties.leads, 6);
  assert.equal(result.features[0].properties.weight, 1);
  assert.equal(result.features[1].properties.weight, 0.5);
});

test("common country aliases match the world boundary dataset", () => {
  assert.equal(normalizeBoundaryName("United States"), "united states of america");
  assert.equal(normalizeBoundaryName("Czech Republic"), "czechia");
});
