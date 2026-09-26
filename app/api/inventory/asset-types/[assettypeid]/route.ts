import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  assertOnlyFields,
  booleanValue,
  inventoryDatabaseError,
  isRecord,
  jsonObjectValue,
  normalizeKey,
  parseInventoryUuid,
  textValue,
} from "@/lib/inventory";
import { requireOperationsContext } from "@/lib/operationsAccess";

type Context = { params: Promise<{ assettypeid: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const id = parseInventoryUuid((await context.params).assettypeid);
  if (!id)
    return NextResponse.json(
      { error: "assetTypeId must be a valid UUID" },
      { status: 400 },
    );
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
      "type_key",
      "display_name",
      "description",
      "icon_key",
      "attribute_schema",
      "is_active",
    ],
    errors,
  );
  const data = {
    type_key:
      body.type_key === undefined
        ? undefined
        : normalizeKey(
            textValue(body.type_key, "type_key", errors, { maximum: 80 }) ?? "",
          ),
    display_name: textValue(body.display_name, "display_name", errors, {
      maximum: 120,
    }),
    description: textValue(body.description, "description", errors, {
      nullable: true,
      maximum: 5000,
    }),
    icon_key: textValue(body.icon_key, "icon_key", errors, {
      nullable: true,
      maximum: 80,
    }),
    attribute_schema: jsonObjectValue(
      body.attribute_schema,
      "attribute_schema",
      errors,
    ),
    is_active: booleanValue(body.is_active, "is_active", errors),
  };
  if (!Object.keys(body).length) errors.push("At least one field is required");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const fields = Object.entries(data).filter(
    ([, value]) => value !== undefined,
  );
  const values: unknown[] = fields.map(([, value]) => value);
  values.push(id, scope.context.access.company.company_id);
  try {
    const result = await pool.query(
      `UPDATE inventory_asset_types SET ${fields.map(([key], index) => `${key}=$${index + 1}`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE asset_type_id=$${values.length - 1} AND company_id=$${values.length} AND is_system=FALSE RETURNING *`,
      values,
    );
    if (!result.rowCount)
      return NextResponse.json(
        { error: "Custom asset type not found; system types cannot be edited" },
        { status: 404 },
      );
    return NextResponse.json({
      message: "Inventory asset type updated",
      asset_type: result.rows[0],
    });
  } catch (error) {
    if (inventoryDatabaseError(error) === "23505")
      return NextResponse.json(
        { error: "An asset type with this key already exists" },
        { status: 409 },
      );
    console.error("Failed to update inventory asset type", error);
    return NextResponse.json(
      { error: "Unable to update inventory asset type" },
      { status: 500 },
    );
  }
}
