import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";

export type LeadBoundaryLevel = "country" | "state" | "district";

export type LeadBoundaryPoint = {
  country: string | null;
  state: string | null;
  district: string | null;
  leads: number;
};

export type LeadBoundaryProperties = {
  name: string;
  leads: number;
  weight: number;
  state?: string;
};

const COUNTRY_ALIASES: Record<string, string> = {
  "united states": "united states of america",
  usa: "united states of america",
  "russian federation": "russia",
  "czech republic": "czechia",
};

export function normalizeBoundaryName(value: string | null | undefined) {
  const normalized = (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return COUNTRY_ALIASES[normalized] ?? normalized;
}

export function buildLeadBoundaryCounts(
  points: LeadBoundaryPoint[],
  level: LeadBoundaryLevel,
  parentState?: string | null,
) {
  const counts = new Map<string, number>();
  const normalizedParent = normalizeBoundaryName(parentState);

  for (const point of points) {
    if (
      normalizedParent &&
      normalizeBoundaryName(point.state) !== normalizedParent
    ) {
      continue;
    }

    const key = normalizeBoundaryName(point[level]);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + point.leads);
  }

  return counts;
}

export function addLeadCountsToBoundaries<
  T extends { name: string; state?: string },
>(
  features: Array<Feature<Polygon | MultiPolygon, T>>,
  counts: Map<string, number>,
): FeatureCollection<Polygon | MultiPolygon, LeadBoundaryProperties> {
  const matched = features.flatMap((boundary) => {
    const leads = counts.get(normalizeBoundaryName(boundary.properties.name)) ?? 0;
    if (!leads) return [];

    return [
      {
        ...boundary,
        properties: {
          name: boundary.properties.name,
          leads,
          state: boundary.properties.state,
          weight: 0,
        },
      },
    ];
  });
  const maxLeads = Math.max(1, ...matched.map((boundary) => boundary.properties.leads));

  return {
    type: "FeatureCollection",
    features: matched.map((boundary) => ({
      ...boundary,
      properties: {
        ...boundary.properties,
        weight: boundary.properties.leads / maxLeads,
      },
    })),
  };
}
