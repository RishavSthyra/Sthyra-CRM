import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  assertOnlyFields,
  inventoryDatabaseError,
  isRecord,
  jsonObjectValue,
  normalizeKey,
  textValue,
} from "@/lib/inventory";
import { requireOperationsContext } from "@/lib/operationsAccess";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const includeInactive =
    request.nextUrl.searchParams.get("include_inactive") === "true";
  try {
    const result = await pool.query(
      `SELECT * FROM inventory_asset_types
       WHERE (company_id IS NULL OR company_id=$1)
         AND ($2::boolean=TRUE OR is_active=TRUE)
       ORDER BY is_system DESC, display_name, asset_type_id`,
      [scope.context.access.company.company_id, includeInactive],
    );
    return NextResponse.json({ asset_types: result.rows });
  } catch (error) {
    console.error("Failed to list inventory asset types", error);
    return NextResponse.json(
      { error: "Unable to retrieve inventory asset types" },
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
    ["type_key", "display_name", "description", "icon_key", "attribute_schema"],
    errors,
  );
  const displayName = textValue(body.display_name, "display_name", errors, {
    required: true,
    maximum: 120,
  });
  const rawKey = textValue(body.type_key, "type_key", errors, {
    nullable: true,
    maximum: 80,
  });
  const typeKey = normalizeKey(rawKey || displayName || "");
  if (!typeKey)
    errors.push("type_key or display_name must produce a valid key");
  const description = textValue(body.description, "description", errors, {
    nullable: true,
    maximum: 5000,
  });
  const iconKey = textValue(body.icon_key, "icon_key", errors, {
    nullable: true,
    maximum: 80,
  });
  const schema =
    jsonObjectValue(body.attribute_schema, "attribute_schema", errors) ?? {};
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  try {
    const result = await pool.query(
      `INSERT INTO inventory_asset_types
       (company_id,type_key,display_name,description,icon_key,attribute_schema)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        scope.context.access.company.company_id,
        typeKey,
        displayName,
        description ?? null,
        iconKey ?? null,
        schema,
      ],
    );
    return NextResponse.json(
      { message: "Inventory asset type created", asset_type: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    if (inventoryDatabaseError(error) === "23505")
      return NextResponse.json(
        { error: "An asset type with this key already exists" },
        { status: 409 },
      );
    console.error("Failed to create inventory asset type", error);
    return NextResponse.json(
      { error: "Unable to create inventory asset type" },
      { status: 500 },
    );
  }
}
