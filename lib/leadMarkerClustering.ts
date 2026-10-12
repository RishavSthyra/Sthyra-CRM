import type { Feature, Point } from "geojson";
import Supercluster from "supercluster";

export type ClusterableLead = {
  latitude: number;
  longitude: number;
  leads: number;
};

export type LeadClusterPointProperties = {
  pointIndex: number;
  leads: number;
};

export type LeadClusterTotals = {
  leads: number;
};

export function clusterZoomForMapZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 0;
  return Math.max(0, Math.round(zoom));
}

export function buildLeadClusterIndex(points: ClusterableLead[]) {
  const features: Array<Feature<Point, LeadClusterPointProperties>> = points.map(
    (point, pointIndex) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [point.longitude, point.latitude],
      },
      properties: {
        pointIndex,
        leads: point.leads,
      },
    }),
  );

  return new Supercluster<LeadClusterPointProperties, LeadClusterTotals>({
    maxZoom: 13,
    minPoints: 2,
    radius: 48,
    map: (properties) => ({ leads: properties.leads }),
    reduce: (total, properties) => {
      total.leads += properties.leads;
    },
  }).load(features);
}
