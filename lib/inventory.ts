import type { Pool, PoolClient } from "pg";
import { isUuid } from "@/lib/permissions";
import type { UserProjectAccess } from "@/lib/projectAccess";
import { canAccessProject } from "@/lib/projectAccess";
import { isObject } from "@/utils/isObject";

type Queryable = Pick<Pool | PoolClient, "query">;

export const INVENTORY_STATUSES = [
  "available",
  "held",
  "reserved",
  "booked",
  "sold",
  "blocked",
  "unavailable",
] as const;

export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const INVENTORY_UNIT_COLUMNS = `
  iu.unit_id, iu.company_id, iu.project_id, iu.node_id, iu.unit_type_id,
  iu.unit_code, iu.unit_name, iu.external_unit_key, iu.orientation,
  iu.area_sqft, iu.price_override, iu.currency, iu.status, iu.metadata,
  iu.version, iu.archived_at, iu.created_at, iu.updated_at,
  node.node_kind, node.node_code, node.node_name,
  unit_type.type_code, unit_type.type_name, unit_type.configuration,
  unit_type.carpet_area_sqft, unit_type.built_up_area_sqft,
  unit_type.saleable_area_sqft, unit_type.base_price,
  unit_type.currency AS type_currency,
  unit_type.specifications AS type_specifications,
  asset_type.type_key AS asset_type_key,
  asset_type.display_name AS asset_type_name
`;

export function parseInventoryUuid(value: string): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

export function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value);
}

export function textValue(
  value: unknown,
  field: string,
  errors: string[],
  options: { required?: boolean; nullable?: boolean; maximum?: number } = {},
): string | null | undefined {
  if (value === undefined) {
    if (options.required) errors.push(`${field} is required`);
    return undefined;
  }
  if (value === null) {
    if (options.nullable) return null;
    errors.push(`${field} cannot be null`);
    return undefined;
  }
  if (typeof value !== "string") {
    errors.push(`${field} must be a string`);
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    if (options.nullable) return null;
    errors.push(`${field} cannot be empty`);
    return undefined;
  }
  if (normalized.length > (options.maximum ?? 500)) {
    errors.push(
      `${field} must be at most ${options.maximum ?? 500} characters`,
    );
    return undefined;
  }
  return normalized;
}

export function numberValue(
  value: unknown,
  field: string,
  errors: string[],
  options: { nullable?: boolean; minimum?: number; integer?: boolean } = {},
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && options.nullable) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(
      `${field} must be a finite number${options.nullable ? " or null" : ""}`,
    );
    return undefined;
  }
  if (options.integer && !Number.isInteger(value)) {
    errors.push(`${field} must be an integer`);
    return undefined;
  }
  if (value < (options.minimum ?? 0)) {
    errors.push(`${field} must be at least ${options.minimum ?? 0}`);
    return undefined;
  }
  return value;
}

export function uuidValue(
  value: unknown,
  field: string,
  errors: string[],
  nullable = false,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !isUuid(value)) {
    errors.push(`${field} must be a valid UUID${nullable ? " or null" : ""}`);
    return undefined;
  }
  return value.toLowerCase();
}

export function jsonObjectValue(
  value: unknown,
  field: string,
  errors: string[],
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push(`${field} must be a JSON object`);
    return undefined;
  }
  return value;
}

export function booleanValue(
  value: unknown,
  field: string,
  errors: string[],
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    errors.push(`${field} must be true or false`);
    return undefined;
  }
  return value;
}

export function assertOnlyFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
  errors: string[],
) {
  const fields = new Set(allowed);
  Object.keys(body)
    .filter((key) => !fields.has(key))
    .forEach((key) => errors.push(`Unknown field: ${key}`));
}

export function parseProjectForAccess(
  value: unknown,
  access: UserProjectAccess,
): number | null {
  const projectId =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(projectId) &&
    projectId > 0 &&
    canAccessProject(access, projectId)
    ? projectId
    : null;
}

export async function getInventoryUnit(
  db: Queryable,
  unitId: string,
  lock = false,
) {
  const result = await db.query(
    `SELECT ${INVENTORY_UNIT_COLUMNS}
     FROM inventory_units iu
     LEFT JOIN project_inventory_nodes node ON node.node_id=iu.node_id
     LEFT JOIN inventory_unit_types unit_type ON unit_type.unit_type_id=iu.unit_type_id
     LEFT JOIN inventory_asset_types asset_type ON asset_type.asset_type_id=unit_type.asset_type_id
     WHERE iu.unit_id=$1${lock ? " FOR UPDATE OF iu" : ""}`,
    [unitId],
  );
  return result.rows[0] ?? null;
}

export async function recordInventoryStatus(
  db: Queryable,
  unitId: string,
  fromStatus: string | null,
  toStatus: InventoryStatus,
  performedBy: string,
  reason: string | null,
  metadata: Record<string, unknown> = {},
) {
  await db.query(
    `INSERT INTO inventory_unit_status_history
       (unit_id,from_status,to_status,reason,metadata,performed_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [unitId, fromStatus, toStatus, reason, metadata, performedBy],
  );
}

export function canTransitionInventoryStatus(
  from: InventoryStatus,
  to: InventoryStatus,
): boolean {
  if (from === to) return false;
  const transitions: Record<InventoryStatus, InventoryStatus[]> = {
    available: ["held", "reserved", "blocked", "unavailable"],
    held: ["available", "reserved", "blocked"],
    reserved: ["available", "booked", "blocked"],
    booked: ["reserved", "sold"],
    sold: [],
    blocked: ["available", "unavailable"],
    unavailable: ["available", "blocked"],
  };
  return transitions[from].includes(to);
}

export function isInventoryStatus(value: unknown): value is InventoryStatus {
  return INVENTORY_STATUSES.includes(value as InventoryStatus);
}

export async function validateCatalogReferences(
  db: Queryable,
  companyId: number,
  projectId: number,
  references: {
    nodeId?: string | null;
    unitTypeId?: string | null;
    assetTypeId?: string | null;
    floorPlanId?: string | null;
  },
): Promise<string[]> {
  const errors: string[] = [];
  if (references.nodeId) {
    const result = await db.query(
      "SELECT 1 FROM project_inventory_nodes WHERE node_id=$1 AND company_id=$2 AND project_id=$3",
      [references.nodeId, companyId, projectId],
    );
    if (!result.rowCount)
      errors.push("node_id must belong to the selected project");
  }
  if (references.unitTypeId) {
    const result = await db.query(
      "SELECT 1 FROM inventory_unit_types WHERE unit_type_id=$1 AND company_id=$2 AND project_id=$3",
      [references.unitTypeId, companyId, projectId],
    );
    if (!result.rowCount)
      errors.push("unit_type_id must belong to the selected project");
  }
  if (references.assetTypeId) {
    const result = await db.query(
      `SELECT 1 FROM inventory_asset_types
       WHERE asset_type_id=$1 AND is_active=TRUE AND (company_id IS NULL OR company_id=$2)`,
      [references.assetTypeId, companyId],
    );
    if (!result.rowCount)
      errors.push("asset_type_id is not available to this company");
  }
  if (references.floorPlanId) {
    const result = await db.query(
      "SELECT 1 FROM inventory_floor_plans WHERE floor_plan_id=$1 AND company_id=$2 AND project_id=$3",
      [references.floorPlanId, companyId, projectId],
    );
    if (!result.rowCount)
      errors.push("floor_plan_id must belong to the selected project");
  }
  return errors;
}

export async function validateInventoryAttributeValues(
  db: Queryable,
  projectId: number,
  appliesTo: "unit_type" | "unit",
  values: Record<string, unknown>,
) {
  const result = await db.query(
    `SELECT attribute_key,label,data_type,is_required,options
     FROM inventory_attribute_definitions
     WHERE project_id=$1 AND applies_to=$2 AND is_active=TRUE
     ORDER BY display_order,label`,
    [projectId, appliesTo],
  );
  const errors: string[] = [];
  for (const definition of result.rows) {
    const value = values[definition.attribute_key];
    const empty =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (empty) {
      if (definition.is_required)
        errors.push(`${definition.label} is required`);
      continue;
    }
    const options = Array.isArray(definition.options)
      ? definition.options.map(String)
      : [];
    if (definition.data_type === "text" && typeof value !== "string")
      errors.push(`${definition.label} must be text`);
    else if (
      definition.data_type === "number" &&
      (typeof value !== "number" || !Number.isFinite(value))
    )
      errors.push(`${definition.label} must be a finite number`);
    else if (definition.data_type === "boolean" && typeof value !== "boolean")
      errors.push(`${definition.label} must be true or false`);
    else if (
      definition.data_type === "date" &&
      (typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    )
      errors.push(`${definition.label} must be a valid date`);
    else if (
      definition.data_type === "select" &&
      (typeof value !== "string" || !options.includes(value))
    )
      errors.push(`${definition.label} must use one of its configured options`);
    else if (
      definition.data_type === "multi_select" &&
      (!Array.isArray(value) ||
        value.some((item) =>
          typeof item === "string" ? !options.includes(item) : true,
        ))
    )
      errors.push(`${definition.label} contains an invalid option`);
  }
  return errors;
}

export function inventoryDatabaseError(error: unknown): string | null {
  if (!isObject(error) || typeof error.code !== "string") return null;
  return error.code;
}
