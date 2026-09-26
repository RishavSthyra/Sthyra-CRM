import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  assertOnlyFields,
  inventoryDatabaseError,
  isRecord,
  jsonObjectValue,
  numberValue,
  parseProjectForAccess,
  textValue,
  uuidValue,
  validateCatalogReferences,
} from "@/lib/inventory";
import { requireOperationsContext } from "@/lib/operationsAccess";

const TYPE_SELECT = `SELECT ut.*, at.type_key AS asset_type_key, at.display_name AS asset_type_name,
  COALESCE(jsonb_agg(jsonb_build_object('floor_plan_id',fp.floor_plan_id,'plan_code',fp.plan_code,'plan_name',fp.plan_name,'version',fp.version,'plan_role',link.plan_role,'display_order',link.display_order) ORDER BY link.display_order) FILTER (WHERE fp.floor_plan_id IS NOT NULL),'[]'::jsonb) AS floor_plans
  FROM inventory_unit_types ut JOIN inventory_asset_types at ON at.asset_type_id=ut.asset_type_id
  LEFT JOIN inventory_unit_type_floor_plans link ON link.unit_type_id=ut.unit_type_id
  LEFT JOIN inventory_floor_plans fp ON fp.floor_plan_id=link.floor_plan_id`;

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const projectId = parseProjectForAccess(
    request.nextUrl.searchParams.get("project_id"),
    scope.context.access,
  );
  if (!projectId)
    return NextResponse.json(
      { error: "A valid accessible project_id is required" },
      { status: 400 },
    );
  const includeInactive =
    request.nextUrl.searchParams.get("include_inactive") === "true";
  try {
    const result = await pool.query(
      `${TYPE_SELECT} WHERE ut.project_id=$1 AND ($2::boolean=TRUE OR ut.is_active=TRUE) GROUP BY ut.unit_type_id,at.asset_type_id ORDER BY ut.type_name,ut.unit_type_id`,
      [projectId, includeInactive],
    );
    return NextResponse.json({ unit_types: result.rows });
  } catch (error) {
    console.error("Failed to list inventory unit types", error);
    return NextResponse.json(
      { error: "Unable to retrieve inventory unit types" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  if (!isRecord(body))
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 422 },
    );
  const errors: string[] = [];
  assertOnlyFields(
    body,
    [
      "project_id",
      "asset_type_id",
      "type_code",
      "type_name",
      "configuration",
      "bedrooms",
      "bathrooms",
      "balconies",
      "carpet_area_sqft",
      "built_up_area_sqft",
      "saleable_area_sqft",
      "base_price",
      "currency",
      "specifications",
      "floor_plan_id",
    ],
    errors,
  );
  const projectId = parseProjectForAccess(
    body.project_id,
    scope.context.access,
  );
  if (!projectId) errors.push("project_id must be an accessible project");
  const assetTypeId = uuidValue(body.asset_type_id, "asset_type_id", errors);
  const floorPlanId = uuidValue(
    body.floor_plan_id,
    "floor_plan_id",
    errors,
    true,
  );
  const typeCode = textValue(body.type_code, "type_code", errors, {
    required: true,
    maximum: 100,
  });
  const typeName = textValue(body.type_name, "type_name", errors, {
    required: true,
    maximum: 200,
  });
  const configuration = textValue(body.configuration, "configuration", errors, {
    nullable: true,
    maximum: 100,
  });
  const numbers = Object.fromEntries(
    ["bedrooms", "bathrooms", "balconies"].map((field) => [
      field,
      numberValue(body[field], field, errors, { nullable: true, minimum: 0 }),
    ]),
  );
  for (const field of [
    "carpet_area_sqft",
    "built_up_area_sqft",
    "saleable_area_sqft",
  ])
    numbers[field] = numberValue(body[field], field, errors, {
      nullable: true,
      minimum: 0.01,
    });
  numbers.base_price = numberValue(body.base_price, "base_price", errors, {
    nullable: true,
    minimum: 0,
  });
  const currency = (
    textValue(body.currency, "currency", errors, { maximum: 3 }) ?? "INR"
  ).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    errors.push("currency must be a three-letter ISO code");
  const specifications =
    jsonObjectValue(body.specifications, "specifications", errors) ?? {};
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const referenceErrors = await validateCatalogReferences(
      client,
      scope.context.access.company.company_id,
      projectId!,
      { assetTypeId: assetTypeId!, floorPlanId: floorPlanId ?? null },
    );
    if (referenceErrors.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Validation failed", details: referenceErrors },
        { status: 422 },
      );
    }
    const result = await client.query(
      `INSERT INTO inventory_unit_types (company_id,project_id,asset_type_id,type_code,type_name,configuration,bedrooms,bathrooms,balconies,carpet_area_sqft,built_up_area_sqft,saleable_area_sqft,base_price,currency,specifications) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        scope.context.access.company.company_id,
        projectId,
        assetTypeId,
        typeCode,
        typeName,
        configuration ?? null,
        numbers.bedrooms ?? null,
        numbers.bathrooms ?? null,
        numbers.balconies ?? null,
        numbers.carpet_area_sqft ?? null,
        numbers.built_up_area_sqft ?? null,
        numbers.saleable_area_sqft ?? null,
        numbers.base_price ?? null,
        currency,
        specifications,
      ],
    );
    if (floorPlanId)
      await client.query(
        "INSERT INTO inventory_unit_type_floor_plans (unit_type_id,floor_plan_id,plan_role) VALUES ($1,$2,'primary')",
        [result.rows[0].unit_type_id, floorPlanId],
      );
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Inventory unit type created", unit_type: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (inventoryDatabaseError(error) === "23505")
      return NextResponse.json(
        { error: "A unit type with this code already exists in the project" },
        { status: 409 },
      );
    console.error("Failed to create inventory unit type", error);
    return NextResponse.json(
      { error: "Unable to create inventory unit type" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
