import { City, Country, State } from "country-state-city";

export type LocationOption = {
  iso_code?: string;
  name: string;
};

export type CanonicalLocation = {
  city: string | null;
  country: string;
  country_code: string;
  latitude: number;
  longitude: number;
  state: string | null;
  state_code: string | null;
};

type LocationInput = {
  city?: unknown;
  country?: unknown;
  country_code?: unknown;
  state?: unknown;
  state_code?: unknown;
};

type LocationValidation =
  | { ok: true; location: CanonicalLocation | null }
  | { ok: false; errors: string[] };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value: unknown) {
  return text(value)
    .toLocaleLowerCase("en")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function coordinate(value: string | undefined, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

function matches(record: { isoCode?: string; name: string }, name: string, code: string) {
  if (code && record.isoCode?.toUpperCase() !== code.toUpperCase()) return false;
  if (name && normalized(record.name) !== normalized(name)) return false;
  return Boolean(code || name);
}

export function listCountries(): LocationOption[] {
  return Country.getAllCountries()
    .map((country) => ({ iso_code: country.isoCode, name: country.name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function listStates(countryCode: string): LocationOption[] | null {
  const country = Country.getCountryByCode(countryCode.toUpperCase());
  if (!country) return null;
  return State.getStatesOfCountry(country.isoCode)
    .map((state) => ({ iso_code: state.isoCode, name: state.name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function listCities(
  countryCode: string,
  stateCode?: string | null,
): LocationOption[] | null {
  const country = Country.getCountryByCode(countryCode.toUpperCase());
  if (!country) return null;
  const cities = stateCode
    ? City.getCitiesOfState(country.isoCode, stateCode.toUpperCase())
    : City.getCitiesOfCountry(country.isoCode);
  if (!cities) return [];
  return [...new Map(cities.map((city) => [normalized(city.name), city.name])).values()]
    .map((name) => ({ name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function validateLocationSelection(input: LocationInput): LocationValidation {
  const countryName = text(input.country);
  const countryCode = text(input.country_code);
  const stateName = text(input.state);
  const stateCode = text(input.state_code);
  const cityName = text(input.city);
  const hasAnyLocation = Boolean(
    countryName || countryCode || stateName || stateCode || cityName,
  );

  if (!hasAnyLocation) return { ok: true, location: null };
  if (!countryName && !countryCode) {
    return { ok: false, errors: ["Select a country before selecting a state or city"] };
  }

  const country = Country.getAllCountries().find((candidate) =>
    matches(candidate, countryName, countryCode),
  );
  if (!country) {
    return { ok: false, errors: ["country must be selected from the location list"] };
  }

  const states = State.getStatesOfCountry(country.isoCode);
  const state =
    stateName || stateCode
      ? states.find((candidate) => matches(candidate, stateName, stateCode)) ?? null
      : null;
  if ((stateName || stateCode) && !state) {
    return {
      ok: false,
      errors: ["state must belong to the selected country"],
    };
  }
  if (cityName && states.length > 0 && !state) {
    return {
      ok: false,
      errors: ["Select a state before selecting a city"],
    };
  }

  const cities = state
    ? City.getCitiesOfState(country.isoCode, state.isoCode)
    : City.getCitiesOfCountry(country.isoCode) ?? [];
  const city = cityName
    ? cities.find((candidate) => normalized(candidate.name) === normalized(cityName)) ?? null
    : null;
  if (cityName && !city) {
    return {
      ok: false,
      errors: ["city must belong to the selected state and country"],
    };
  }

  const latitude = coordinate(
    city?.latitude ?? state?.latitude ?? country.latitude,
    -90,
    90,
  );
  const longitude = coordinate(
    city?.longitude ?? state?.longitude ?? country.longitude,
    -180,
    180,
  );
  if (latitude === null || longitude === null) {
    return {
      ok: false,
      errors: ["The selected location does not include map coordinates"],
    };
  }

  return {
    ok: true,
    location: {
      city: city?.name ?? null,
      country: country.name,
      country_code: country.isoCode,
      latitude,
      longitude,
      state: state?.name ?? null,
      state_code: state?.isoCode ?? null,
    },
  };
}
