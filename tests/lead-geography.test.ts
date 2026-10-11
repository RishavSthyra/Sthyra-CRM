import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeadGeography,
  resolveLeadGeographyRow,
} from "../lib/leadGeography";

test("lead geography resolves country, state and city centroids", () => {
  const point = resolveLeadGeographyRow({
    country: "India",
    state: "Karnataka",
    city: "Bengaluru",
    leads: 7,
  });

  assert.ok(point);
  assert.equal(point.precision, "city");
  assert.equal(point.country, "India");
  assert.equal(point.state, "Karnataka");
  assert.equal(point.city, "Bengaluru");
  assert.equal(point.leads, 7);
  assert.ok(Math.abs(point.latitude - 12.97194) < 0.001);
  assert.ok(Math.abs(point.longitude - 77.59369) < 0.001);
});

test("lead geography uses supplied coordinates at the best available precision", () => {
  const point = resolveLeadGeographyRow({
    country: "India",
    state: "West Bengal",
    district: "Kolkata",
    latitude: "22.5726",
    longitude: "88.3639",
    leads: 2,
  });

  assert.ok(point);
  assert.equal(point.precision, "district");
  assert.equal(point.label, "Kolkata, West Bengal, India");
});

test("lead geography reports mapped and unmapped lead coverage", () => {
  const geography = buildLeadGeography(
    [
      { country: "India", leads: 4 },
      { country: "IN", leads: 3 },
      { country: null, city: "Unknown", leads: 5 },
    ],
    12,
  );

  assert.equal(geography.points.length, 1);
  assert.equal(geography.points[0].leads, 7);
  assert.equal(geography.mapped_leads, 7);
  assert.equal(geography.unmapped_leads, 5);
});

test("missing coordinates are not interpreted as zero latitude and longitude", () => {
  assert.equal(
    resolveLeadGeographyRow({ country: null, latitude: null, longitude: null, leads: 4 }),
    null,
  );
});
