import { validateText } from "@/utils/validateText";
import { validateCoordinate } from "@/utils/validateCoordinate";

export const REGION_COLUMNS = `
  region_id,
  region_name,
  region_code,
  region_type,
  state,
  latitude,
  longitude,
  timezone,
  is_active,
  created_at,
  updated_at
`;

const REGION_FIELDS = [
  "region_name",
  "region_code",
  "region_type",
  "state",
  "latitude",
  "longitude",
  "timezone",
  "is_active",
] as const;

export type RegionField = (typeof REGION_FIELDS)[number];

export type RegionWrite = Partial<{
  region_name: string;
  region_code: string;
  region_type: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  is_active: boolean;
}>;

type ValidationResult =
  | { ok: true; data: RegionWrite }
  | { ok: false; errors: string[] };


type RegionRow = Record<string, unknown> & {
  latitude?: string | number | null;
  longitude?: string | number | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateRegionPayload(
  body: unknown,
  options: { partial: boolean },
): ValidationResult {

  if (!isObject(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const allowedFields = new Set<string>(REGION_FIELDS);

  const unknownFields = Object.keys(body).filter(
    (field) => !allowedFields.has(field),
  );

  const errors = unknownFields.map((field) => `Unknown field: ${field}`);

  const data: RegionWrite = {};

  const regionName = validateText(
    body.region_name,
    "region_name",
    200,
    false,
    errors,
  );

  if (typeof regionName === "string") data.region_name = regionName;

  const regionCode = validateText(
    body.region_code,
    "region_code",
    20,
    false,
    errors,
  );

  if (typeof regionCode === "string") {
    data.region_code = regionCode.toUpperCase();
  }

  const regionType = validateText(
    body.region_type,
    "region_type",
    50,
    true,
    errors,
  );

  if (regionType !== undefined) data.region_type = regionType;

  const state = validateText(body.state, "state", 200, true, errors);

  if (state !== undefined) data.state = state;

  const latitude = validateCoordinate(body.latitude, "latitude", errors);

  if (latitude !== undefined) data.latitude = latitude;

  const longitude = validateCoordinate(body.longitude, "longitude", errors);

  if (longitude !== undefined) data.longitude = longitude;

  const timezone = validateText(
    body.timezone,
    "timezone",
    200,
    true,
    errors,
  );

  if (timezone !== undefined) {
    if (timezone !== null) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
        data.timezone = timezone;
      } catch {
        errors.push("timezone must be a valid IANA timezone");
      }
    } else {
      data.timezone = null;
    }
  }

  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") {
      errors.push("is_active must be a boolean");
    } else {
      data.is_active = body.is_active;
    }
  }

  if (!options.partial) {
    if (body.region_name === undefined) errors.push("region_name is required");
    if (body.region_code === undefined) errors.push("region_code is required");
    if (body.is_active === undefined) data.is_active = true;
  } else if (Object.keys(body).length === 0) {
    errors.push("At least one field is required");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, data };
}

export function parseRegionId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;

  const id = Number(value);

  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function getDatabaseErrorCode(error: unknown): string | null {

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return null;

}

export function serializeRegion(row: RegionRow): RegionRow {
  return {
    ...row,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
  };
}
