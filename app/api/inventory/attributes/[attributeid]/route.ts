import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  booleanValue,
  inventoryDatabaseError,
  isRecord,
  normalizeKey,
  numberValue,
  parseInventoryUuid,
  textValue,
} from "@/lib/inventory";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
type Context = { params: Promise<{ attributeid: string }> };
export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const id = parseInventoryUuid((await context.params).attributeid);
  if (!id)
    return NextResponse.json(
      { error: "attributeId must be a valid UUID" },
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
  const existing = await pool.query(
    "SELECT * FROM inventory_attribute_definitions WHERE definition_id=$1",
    [id],
  );
  if (!existing.rowCount)
    return NextResponse.json(
      { error: "Inventory attribute not found" },
      { status: 404 },
    );
  const current = existing.rows[0];
  if (
    !canAccessOperationsEntity(
      scope.context.access,
      Number(current.company_id),
      Number(current.project_id),
    )
  )
    return NextResponse.json(
      { error: "You do not have access to this inventory attribute" },
      { status: 403 },
    );
  const errors: string[] = [];
  const data: Record<string, unknown> = {
    label: textValue(body.label, "label", errors, { maximum: 150 }),
    is_required: booleanValue(body.is_required, "is_required", errors),
    display_order: numberValue(body.display_order, "display_order", errors, {
      minimum: 0,
      integer: true,
    }),
    is_active: booleanValue(body.is_active, "is_active", errors),
  };
  if (body.attribute_key !== undefined) {
    const value = textValue(body.attribute_key, "attribute_key", errors, {
      maximum: 100,
    });
    data.attribute_key = value ? normalizeKey(value) : undefined;
  }
  if (body.data_type !== undefined) {
    if (
      !["text", "number", "boolean", "date", "select", "multi_select"].includes(
        String(body.data_type),
      )
    )
      errors.push("data_type is invalid");
    else data.data_type = body.data_type;
  }
  if (body.options !== undefined) {
    if (!Array.isArray(body.options)) errors.push("options must be an array");
    else data.options = body.options;
  }
  const type = String(data.data_type ?? current.data_type);
  const options = (data.options ?? current.options) as unknown[];
  if (
    ["select", "multi_select"].includes(type) &&
    (!Array.isArray(options) || !options.length)
  )
    errors.push("Select attributes require at least one option");
  const fields = Object.entries(data).filter(
    ([, value]) => value !== undefined,
  );
  if (!fields.length) errors.push("At least one mutable field is required");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const values: unknown[] = fields.map(([, value]) => value);
  values.push(id);
  try {
    const result = await pool.query(
      `UPDATE inventory_attribute_definitions SET ${fields.map(([key], index) => `${key}=$${index + 1}`).join(",")},updated_at=CURRENT_TIMESTAMP WHERE definition_id=$${values.length} RETURNING *`,
      values,
    );
    return NextResponse.json({
      message: "Inventory attribute updated",
      attribute: result.rows[0],
    });
  } catch (error) {
    if (inventoryDatabaseError(error) === "23505")
      return NextResponse.json(
        {
          error:
            "An attribute with this key already exists for the selected scope",
        },
        { status: 409 },
      );
    console.error("Failed to update inventory attribute", error);
    return NextResponse.json(
      { error: "Unable to update inventory attribute" },
      { status: 500 },
    );
  }
}
