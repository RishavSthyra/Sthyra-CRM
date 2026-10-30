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
  validateInventoryAttributeValues,
} from "@/lib/inventory";
import { requireOperationsContext } from "@/lib/operationsAccess";
import {
  pricingComponentsValue,
  syncUnitTypeBasePrice,
} from "@/lib/inventoryPricing";
import {
  replaceUnitTypeLayout,
  validateInventoryLayout,
} from "@/lib/inventoryLayouts";

const TYPE_SELECT = `SELECT ut.*, at.type_key AS asset_type_key, at.display_name AS asset_type_name,
  COALESCE(pricing.base_amount,ut.base_price) AS pricing_base_amount,
  COALESCE(pricing.components,'{}'::jsonb) AS pricing_components,
  COALESCE(rooms.items,'[]'::jsonb) AS layout_rooms,
  COALESCE(assets.items,'[]'::jsonb) AS layout_assets
  FROM inventory_unit_types ut JOIN inventory_asset_types at ON at.asset_type_id=ut.asset_type_id
  LEFT JOIN LATERAL (
    SELECT entry.base_amount,entry.components
    FROM inventory_price_books book
    JOIN inventory_price_book_entries entry
      ON entry.price_book_id=book.price_book_id
     AND entry.unit_type_id=ut.unit_type_id
     AND entry.unit_id IS NULL
     AND (entry.valid_from IS NULL OR entry.valid_from<=CURRENT_DATE)
     AND (entry.valid_until IS NULL OR entry.valid_until>=CURRENT_DATE)
    WHERE book.project_id=ut.project_id
      AND book.is_default=TRUE
      AND book.is_active=TRUE
      AND (book.valid_from IS NULL OR book.valid_from<=CURRENT_DATE)
      AND (book.valid_until IS NULL OR book.valid_until>=CURRENT_DATE)
    ORDER BY entry.valid_from DESC NULLS LAST,entry.updated_at DESC
    LIMIT 1
  ) pricing ON TRUE
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(to_jsonb(room) ORDER BY room.display_order,room.room_id) AS items
    FROM inventory_unit_type_rooms room WHERE room.unit_type_id=ut.unit_type_id
  ) rooms ON TRUE
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(to_jsonb(asset) ORDER BY asset.display_order,asset.layout_asset_id) AS items
    FROM inventory_unit_type_layout_assets asset WHERE asset.unit_type_id=ut.unit_type_id
  ) assets ON TRUE`;

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
      `${TYPE_SELECT} WHERE ut.project_id=$1 AND ($2::boolean=TRUE OR ut.is_active=TRUE) ORDER BY ut.type_name,ut.unit_type_id`,
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
      "price_per_sqft",
      "pricing_components",
      "currency",
      "specifications",
      "layout",
    ],
    errors,
  );
  const projectId = parseProjectForAccess(
    body.project_id,
    scope.context.access,
  );
  if (!projectId) errors.push("project_id must be an accessible project");
  const assetTypeId = uuidValue(body.asset_type_id, "asset_type_id", errors);
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
  numbers.price_per_sqft = numberValue(
    body.price_per_sqft,
    "price_per_sqft",
    errors,
    {
      nullable: true,
      minimum: 0,
    },
  );
  if (
    numbers.price_per_sqft !== null &&
    numbers.price_per_sqft !== undefined &&
    (numbers.saleable_area_sqft === null ||
      numbers.saleable_area_sqft === undefined)
  )
    errors.push("saleable_area_sqft is required when price_per_sqft is set");
  const pricingComponents = pricingComponentsValue(
    body.pricing_components,
    errors,
  );
  const currency = (
    textValue(body.currency, "currency", errors, { maximum: 3 }) ?? "INR"
  ).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    errors.push("currency must be a three-letter ISO code");
  const specifications =
    jsonObjectValue(body.specifications, "specifications", errors) ?? {};
  const layoutResult = validateInventoryLayout(body.layout ?? {});
  if (!layoutResult.ok) errors.push(...layoutResult.errors);
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
      { assetTypeId: assetTypeId! },
    );
    if (referenceErrors.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Validation failed", details: referenceErrors },
        { status: 422 },
      );
    }
    const attributeErrors = await validateInventoryAttributeValues(
      client,
      projectId!,
      "unit_type",
      specifications,
    );
    if (attributeErrors.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Validation failed", details: attributeErrors },
        { status: 422 },
      );
    }
    const result = await client.query(
      `INSERT INTO inventory_unit_types (company_id,project_id,asset_type_id,type_code,type_name,configuration,bedrooms,bathrooms,balconies,carpet_area_sqft,built_up_area_sqft,saleable_area_sqft,price_per_sqft,currency,specifications) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
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
        numbers.price_per_sqft ?? null,
        currency,
        specifications,
      ],
    );
    if (layoutResult.ok)
      await replaceUnitTypeLayout(
        client,
        result.rows[0].unit_type_id,
        layoutResult.data,
      );
    const pricingSync = await syncUnitTypeBasePrice(
      client,
      result.rows[0],
      pricingComponents,
    );
    await client.query("COMMIT");
    return NextResponse.json(
      {
        message: "Inventory unit type created",
        unit_type: result.rows[0],
        pricing_sync: pricingSync,
      },
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
