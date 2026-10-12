import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeadClusterIndex,
  clusterZoomForMapZoom,
} from "../lib/leadMarkerClustering";

test("cluster zoom follows fast camera movement without waiting for move end", () => {
  assert.equal(clusterZoomForMapZoom(2.49), 2);
  assert.equal(clusterZoomForMapZoom(2.5), 3);
  assert.equal(clusterZoomForMapZoom(8.8), 9);
});

test("nearby map locations group using the total number of leads", () => {
  const index = buildLeadClusterIndex([
    { latitude: 28.6139, longitude: 77.209, leads: 3 },
    { latitude: 28.4595, longitude: 77.0266, leads: 2 },
  ]);
  const markers = index.getClusters([60, 0, 100, 40], 2);

  assert.equal(markers.length, 1);
  assert.equal("cluster" in markers[0].properties, true);
  if ("cluster" in markers[0].properties) {
    assert.equal(markers[0].properties.point_count, 2);
    assert.equal(markers[0].properties.leads, 5);
  }
});

test("clusters progressively split as the map zooms in", () => {
  const index = buildLeadClusterIndex([
    { latitude: 12.9716, longitude: 77.5946, leads: 4 },
    { latitude: 17.385, longitude: 78.4867, leads: 6 },
  ]);
  const grouped = index.getClusters([60, 5, 90, 25], 2);

  assert.equal(grouped.length, 1);
  assert.ok("cluster" in grouped[0].properties);
  if ("cluster" in grouped[0].properties) {
    const expansionZoom = index.getClusterExpansionZoom(
      grouped[0].properties.cluster_id,
    );
    assert.ok(expansionZoom > 2);
    assert.equal(index.getClusters([60, 5, 90, 25], expansionZoom).length, 2);
  }
});
