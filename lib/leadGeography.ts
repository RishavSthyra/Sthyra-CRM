import { City, Country, State } from "country-state-city";

export type LeadGeographyRow = {
  country?: string | null;
  state?: string | null;
  district?: string | null;
  city?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  leads?: string | number | null;
};

export type LeadGeographyPoint = {
  country: string | null;
  state: string | null;
  district: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  leads: number;
  precision: "country" | "state" | "district" | "city" | "coordinates";
  label: string;
};

function normalized(value: unknown) {
  return typeof value === "string"
    ? value.trim().toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

function finiteCoordinate(value: unknown, min: number, max: number) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : null;
}

function matchByNameOrCode<T extends { name: string; isoCode?: string }>(
  records: T[],
  value: string | null | undefined,
) {
  const target = normalized(value);
  if (!target) return null;
  return (
    records.find(
      (record) =>
        normalized(record.name) === target || normalized(record.isoCode) === target,
    ) ?? null
  );
}

function locationLabel(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(", ");
}

export function resolveLeadGeographyRow(
  row: LeadGeographyRow,
): LeadGeographyPoint | null {
  const leads = Math.max(0, Number(row.leads ?? 0));
  if (!leads) return null;

  const countryText = row.country?.trim() || null;
  const stateText = row.state?.trim() || null;
  const districtText = row.district?.trim() || null;
  const cityText = row.city?.trim() || null;
  const latitude = finiteCoordinate(row.latitude, -90, 90);
  const longitude = finiteCoordinate(row.longitude, -180, 180);

  if (latitude !== null && longitude !== null) {
    const precision = cityText
      ? "city"
      : districtText
        ? "district"
        : stateText
          ? "state"
          : countryText
            ? "country"
            : "coordinates";
    return {
      country: countryText,
      state: stateText,
      district: districtText,
      city: cityText,
      latitude,
      longitude,
      leads,
      precision,
      label:
        locationLabel([cityText, districtText, stateText, countryText]) ||
        "Mapped location",
    };
  }

  const country = matchByNameOrCode(Country.getAllCountries(), countryText);
  if (!country) return null;

  const states = State.getStatesOfCountry(country.isoCode);
  const state = matchByNameOrCode(states, stateText);
  const cities = state
    ? City.getCitiesOfState(country.isoCode, state.isoCode)
    : City.getCitiesOfCountry(country.isoCode) ?? [];
  const city = matchByNameOrCode(cities, cityText);

  if (city) {
    const cityLatitude = finiteCoordinate(city.latitude, -90, 90);
    const cityLongitude = finiteCoordinate(city.longitude, -180, 180);
    if (cityLatitude !== null && cityLongitude !== null) {
      const resolvedState =
        state ??
        states.find((candidate) => candidate.isoCode === city.stateCode) ??
        null;
      return {
        country: country.name,
        state: resolvedState?.name ?? stateText,
        district: districtText,
        city: city.name,
        latitude: cityLatitude,
        longitude: cityLongitude,
        leads,
        precision: "city",
        label: locationLabel([
          city.name,
          districtText,
          resolvedState?.name ?? stateText,
          country.name,
        ]),
      };
    }
  }

  if (state) {
    const stateLatitude = finiteCoordinate(state.latitude, -90, 90);
    const stateLongitude = finiteCoordinate(state.longitude, -180, 180);
    if (stateLatitude !== null && stateLongitude !== null) {
      return {
        country: country.name,
        state: state.name,
        district: districtText,
        city: cityText,
        latitude: stateLatitude,
        longitude: stateLongitude,
        leads,
        precision: "state",
        label: locationLabel([state.name, country.name]),
      };
    }
  }

  const countryLatitude = finiteCoordinate(country.latitude, -90, 90);
  const countryLongitude = finiteCoordinate(country.longitude, -180, 180);
  if (countryLatitude === null || countryLongitude === null) return null;
  return {
    country: country.name,
    state: stateText,
    district: districtText,
    city: cityText,
    latitude: countryLatitude,
    longitude: countryLongitude,
    leads,
    precision: "country",
    label: country.name,
  };
}

export function buildLeadGeography(
  rows: LeadGeographyRow[],
  totalLeads: number,
) {
  const combined = new Map<string, LeadGeographyPoint>();
  for (const row of rows) {
    const point = resolveLeadGeographyRow(row);
    if (!point) continue;
    const key = [
      point.precision,
      point.latitude.toFixed(5),
      point.longitude.toFixed(5),
      normalized(point.label),
    ].join(":");
    const existing = combined.get(key);
    if (existing) existing.leads += point.leads;
    else combined.set(key, { ...point });
  }

  const points = [...combined.values()].sort((left, right) => right.leads - left.leads);
  const mappedLeads = points.reduce((sum, point) => sum + point.leads, 0);
  return {
    points,
    mapped_leads: mappedLeads,
    unmapped_leads: Math.max(0, totalLeads - mappedLeads),
  };
}
