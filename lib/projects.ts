
import { validateText } from "@/utils/validateText";
import { validatePositiveNumber } from "@/utils/validatePositiveNumber";
import { validateDate } from "@/utils/validateDate";
import { validateCoordinate } from "@/utils/validateCoordinate";

export const PROJECT_COLUMNS = `
  p.project_id,
  p.company_id,
  c.company_code,
  c.company_name,
  p.region_id,
  r.region_code,
  r.region_name,
  p.project_code,
  p.project_name,
  p.project_status,
  p.project_type,
  p.project_acres,
  p.start_date::text AS start_date,
  p.expected_completion_date::text AS expected_completion_date,
  p.address,
  p.postal_code,
  p.latitude,
  p.longitude,
  p.rera_number,
  p.is_active,
  p.created_at,
  p.updated_at
`;

export const PROJECT_STATUSES = [
  "planning",
  "launched",
  "under_construction",
  "completed",
  "on_hold",
] as const;

export const PROJECT_TYPES = [
  "residential",
  "commercial",
  "mix_use",
] as const;

const PROJECT_FIELDS = [
  "company_code",
  "region_code",
  "project_code",
  "project_name",
  "project_status",
  "project_type",
  "project_acres",
  "start_date",
  "expected_completion_date",
  "address",
  "postal_code",
  "latitude",
  "longitude",
  "rera_number",
  "is_active",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProjectType = (typeof PROJECT_TYPES)[number];

export type ProjectWrite = Partial<{
  company_code: string;
  region_code: string;
  project_code: string;
  project_name: string;
  project_status: ProjectStatus;
  project_type: ProjectType;
  project_acres: number | null;
  start_date: string | null;
  expected_completion_date: string | null;
  address: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  rera_number: string | null;
  is_active: boolean;
}>;

type ValidationResult =
  | { ok: true; data: ProjectWrite }
  | { ok: false; errors: string[] };

type ProjectRow = Record<string, unknown> & {
  project_acres?: string | number | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


export function isProjectStatus(value: string): value is ProjectStatus {
  return PROJECT_STATUSES.includes(value as ProjectStatus);
}

export function isProjectType(value: string): value is ProjectType {
  return PROJECT_TYPES.includes(value as ProjectType);
}


export function validateProjectPayload(
  body: unknown,
  options: { partial: boolean },
): ValidationResult {


  if (!isObject(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const allowedFields = new Set<string>(PROJECT_FIELDS);
  
  const unknownFields = Object.keys(body).filter(
    (field) => !allowedFields.has(field),
  );

  const errors = unknownFields.map((field) => `Unknown field: ${field}`);
  const data: ProjectWrite = {};

  const companyCode = validateText(
    body.company_code,
    "company_code",
    30,
    false,
    errors,
  );

  if (typeof companyCode === "string") {
    data.company_code = companyCode.toUpperCase();
  }

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

  const projectCode = validateText(
    body.project_code,
    "project_code",
    20,
    false,
    errors,
  );
  if (typeof projectCode === "string") {
    data.project_code = projectCode.toUpperCase();
  }

  const projectName = validateText(
    body.project_name,
    "project_name",
    200,
    false,
    errors,
  );
  if (typeof projectName === "string") data.project_name = projectName;

  if (body.project_status !== undefined) {
    if (
      typeof body.project_status !== "string" ||
      !isProjectStatus(body.project_status)
    ) {
      errors.push(`project_status must be one of: ${PROJECT_STATUSES.join(", ")}`);
    } else {
      data.project_status = body.project_status;
    }
  }

  if (body.project_type !== undefined) {
    if (
      typeof body.project_type !== "string" ||
      !isProjectType(body.project_type)
    ) {
      errors.push(`project_type must be one of: ${PROJECT_TYPES.join(", ")}`);
    } else {
      data.project_type = body.project_type;
    }
  }

  const projectAcres = validatePositiveNumber(
    body.project_acres,
    "project_acres",
    errors,
  );
  
  if (projectAcres !== undefined) data.project_acres = projectAcres;

  const startDate = validateDate(body.start_date, "start_date", errors);
  if (startDate !== undefined) data.start_date = startDate;

  const completionDate = validateDate(
    body.expected_completion_date,
    "expected_completion_date",
    errors,
  );
  if (completionDate !== undefined) {
    data.expected_completion_date = completionDate;
  }

  if (
    typeof startDate === "string" &&
    typeof completionDate === "string" &&
    completionDate < startDate
  ) {
    errors.push("expected_completion_date cannot be earlier than start_date");
  }

  const address = validateText(body.address, "address", 2000, true, errors);

  if (address !== undefined) data.address = address;

  const postalCode = validateText(
    body.postal_code,
    "postal_code",
    20,
    true,
    errors,
  );
  if (postalCode !== undefined) data.postal_code = postalCode;

  const latitude = validateCoordinate(body.latitude, "latitude", errors);
  if (latitude !== undefined) data.latitude = latitude;

  const longitude = validateCoordinate(body.longitude, "longitude", errors);
  if (longitude !== undefined) data.longitude = longitude;

  const reraNumber = validateText(
    body.rera_number,
    "rera_number",
    200,
    true,
    errors,
  );
  if (reraNumber !== undefined) data.rera_number = reraNumber;

  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") {
      errors.push("is_active must be a boolean");
    } else {
      data.is_active = body.is_active;
    }
  }

  if (!options.partial) {
    if (body.company_code === undefined) errors.push("company_code is required");
    if (body.region_code === undefined) errors.push("region_code is required");
    if (body.project_code === undefined) errors.push("project_code is required");
    if (body.project_name === undefined) errors.push("project_name is required");
    if (body.project_status === undefined) data.project_status = "planning";
    if (body.project_type === undefined) data.project_type = "residential";
    if (body.is_active === undefined) data.is_active = true;
  } else if (Object.keys(body).length === 0) {
    errors.push("At least one field is required");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, data };
}


export function getProjectDatabaseErrorCode(error: unknown): string | null {
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

function numericValue(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function serializeProject(row: ProjectRow): ProjectRow {
  return {
    ...row,
    project_acres: numericValue(row.project_acres),
    latitude: numericValue(row.latitude),
    longitude: numericValue(row.longitude),
  };
}
