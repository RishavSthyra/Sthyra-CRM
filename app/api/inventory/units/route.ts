import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  assertOnlyFields,
  INVENTORY_UNIT_COLUMNS,
  inventoryDatabaseError,
  isInventoryStatus,
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
import { getAccessibleProjectIds } from "@/lib/projectAccess";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams, 50, 200);
  if (!pagination.ok)
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  const projectIds = getAccessibleProjectIds(scope.context.access);
  const values: unknown[] = [
    scope.context.access.company.company_id,
    projectIds,
  ];
  const filters = [
    "iu.company_id=$1",
    "iu.project_id=ANY($2::integer[])",
    "iu.archived_at IS NULL",
  ];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue) {
    const id = parseProjectForAccess(projectValue, scope.context.access);
    if (!id)
      return NextResponse.json(
        { error: "Invalid or inaccessible project_id" },
        { status: 400 },
      );
    values.push(id);
    filters.push(`iu.project_id=$${values.length}`);
  }
  const status = request.nextUrl.searchParams.get("status");
  if (status) {
    if (!isInventoryStatus(status))
      return NextResponse.json(
        { error: "Invalid inventory status" },
        { status: 400 },
      );
    values.push(status);
    filters.push(`iu.status=$${values.length}`);
  }
  for (const [parameter, column] of [
    ["node_id", "iu.node_id"],
    ["unit_type_id", "iu.unit_type_id"],
    ["asset_type_id", "unit_type.asset_type_id"],
  ] as const) {
    const raw = request.nextUrl.searchParams.get(parameter);
    if (!raw) continue;
    const id = uuidValue(raw, parameter, [], false);
    if (!id)
      return NextResponse.json(
        { error: `${parameter} must be a valid UUID` },
        { status: 400 },
      );
    values.push(id);
    filters.push(`${column}=$${values.length}`);
  }
  const search = request.nextUrl.searchParams.get("search")?.trim();
  if (search) {
    values.push(`%${search}%`);
    filters.push(
      `(iu.unit_code ILIKE $${values.length} OR iu.unit_name ILIKE $${values.length} OR iu.external_unit_key ILIKE $${values.length} OR unit_type.type_name ILIKE $${values.length})`,
    );
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM inventory_units iu LEFT JOIN inventory_unit_types unit_type ON unit_type.unit_type_id=iu.unit_type_id ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${INVENTORY_UNIT_COLUMNS},
        COALESCE(iu.price_override,effective_price.total_amount,unit_type.base_price) AS effective_price,
        CASE
          WHEN iu.price_override IS NOT NULL THEN iu.currency
          WHEN effective_price.total_amount IS NOT NULL THEN effective_price.currency
          ELSE unit_type.currency
        END AS effective_price_currency,
        CASE
          WHEN iu.price_override IS NOT NULL THEN 'unit_override'
          WHEN effective_price.total_amount IS NOT NULL THEN effective_price.source
          WHEN unit_type.base_price IS NOT NULL THEN 'unit_type_fallback'
          ELSE NULL
        END AS effective_price_source
       FROM inventory_units iu
       LEFT JOIN project_inventory_nodes node ON node.node_id=iu.node_id
       LEFT JOIN inventory_unit_types unit_type ON unit_type.unit_type_id=iu.unit_type_id
       LEFT JOIN inventory_asset_types asset_type ON asset_type.asset_type_id=unit_type.asset_type_id
       LEFT JOIN LATERAL (
         SELECT
           book.currency,
           CASE WHEN entry.unit_id IS NOT NULL THEN 'unit_price_book' ELSE entry.source END AS source,
           entry.base_amount + COALESCE((
             SELECT SUM(component.value::numeric)
             FROM jsonb_each_text(entry.components) component
             WHERE component.value ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
           ),0) AS total_amount
         FROM inventory_price_books book
         JOIN inventory_price_book_entries entry
           ON entry.price_book_id=book.price_book_id
         WHERE book.project_id=iu.project_id
           AND book.is_default=TRUE
           AND book.is_active=TRUE
           AND (book.valid_from IS NULL OR book.valid_from<=CURRENT_DATE)
           AND (book.valid_until IS NULL OR book.valid_until>=CURRENT_DATE)
           AND (entry.unit_id=iu.unit_id OR
             (entry.unit_id IS NULL AND entry.unit_type_id=iu.unit_type_id))
           AND (entry.valid_from IS NULL OR entry.valid_from<=CURRENT_DATE)
           AND (entry.valid_until IS NULL OR entry.valid_until>=CURRENT_DATE)
         ORDER BY CASE WHEN entry.unit_id=iu.unit_id THEN 0 ELSE 1 END,
           entry.valid_from DESC NULLS LAST,entry.updated_at DESC
         LIMIT 1
       ) effective_price ON TRUE
       ${where}
       ORDER BY iu.unit_code,iu.unit_id
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      units: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list inventory units", error);
    return NextResponse.json(
      { error: "Unable to retrieve inventory units" },
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
      "node_id",
      "unit_type_id",
      "unit_code",
      "unit_name",
      "external_unit_key",
      "orientation",
      "area_sqft",
      "price_override",
      "currency",
      "metadata",
    ],
    errors,
  );
  const projectId = parseProjectForAccess(
    body.project_id,
    scope.context.access,
  );
  if (!projectId) errors.push("project_id must be an accessible project");
  const nodeId = uuidValue(body.node_id, "node_id", errors, true);
  const unitTypeId = uuidValue(body.unit_type_id, "unit_type_id", errors);
  const unitCode = textValue(body.unit_code, "unit_code", errors, {
    required: true,
    maximum: 100,
  });
  const unitName = textValue(body.unit_name, "unit_name", errors, {
    nullable: true,
    maximum: 200,
  });
  const externalKey = textValue(
    body.external_unit_key,
    "external_unit_key",
    errors,
    { nullable: true, maximum: 200 },
  );
  const orientation = textValue(body.orientation, "orientation", errors, {
    nullable: true,
    maximum: 100,
  });
  const area = numberValue(body.area_sqft, "area_sqft", errors, {
    nullable: true,
    minimum: 0.01,
  });
  const price = numberValue(body.price_override, "price_override", errors, {
    nullable: true,
    minimum: 0,
  });
  const currency = (
    textValue(body.currency, "currency", errors, { maximum: 3 }) ?? "INR"
  ).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    errors.push("currency must be a three-letter ISO code");
  const metadata = jsonObjectValue(body.metadata, "metadata", errors) ?? {};
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
      { nodeId: nodeId ?? null, unitTypeId: unitTypeId! },
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
      "unit",
      metadata,
    );
    if (attributeErrors.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Validation failed", details: attributeErrors },
        { status: 422 },
      );
    }
    const result = await client.query(
      `INSERT INTO inventory_units (company_id,project_id,node_id,unit_type_id,unit_code,unit_name,external_unit_key,orientation,area_sqft,price_override,currency,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        scope.context.access.company.company_id,
        projectId,
        nodeId ?? null,
        unitTypeId,
        unitCode,
        unitName ?? null,
        externalKey ?? null,
        orientation ?? null,
        area ?? null,
        price ?? null,
        currency,
        metadata,
      ],
    );
    await client.query(
      `INSERT INTO inventory_unit_status_history (unit_id,from_status,to_status,reason,metadata,performed_by) VALUES ($1,NULL,'available','Inventory unit created',$2,$3)`,
      [result.rows[0].unit_id, { source: "api" }, scope.context.userId],
    );
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Inventory unit created", unit: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (inventoryDatabaseError(error) === "23505")
      return NextResponse.json(
        {
          error:
            "A unit with this code or external key already exists in the project",
        },
        { status: 409 },
      );
    console.error("Failed to create inventory unit", error);
    return NextResponse.json(
      { error: "Unable to create inventory unit" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
