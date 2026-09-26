import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  assertOnlyFields,
  booleanValue,
  inventoryDatabaseError,
  isRecord,
  jsonObjectValue,
  parseInventoryUuid,
  textValue,
} from "@/lib/inventory";
import { requireOperationsContext } from "@/lib/operationsAccess";

type Context = { params: Promise<{ floorplanid: string }> };
export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const id = parseInventoryUuid((await context.params).floorplanid);
  if (!id)
    return NextResponse.json(
      { error: "floorPlanId must be a valid UUID" },
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
      "plan_code",
      "plan_name",
      "description",
      "dimensions",
      "content_hash",
      "is_active",
    ],
    errors,
  );
  const data = {
    plan_code: textValue(body.plan_code, "plan_code", errors, { maximum: 100 }),
    plan_name: textValue(body.plan_name, "plan_name", errors, { maximum: 200 }),
    description: textValue(body.description, "description", errors, {
      nullable: true,
      maximum: 10000,
    }),
    dimensions: jsonObjectValue(body.dimensions, "dimensions", errors),
    content_hash: textValue(body.content_hash, "content_hash", errors, {
      nullable: true,
      maximum: 128,
    }),
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
      `UPDATE inventory_floor_plans SET ${fields.map(([key], index) => `${key}=$${index + 1}`).join(",")},updated_at=CURRENT_TIMESTAMP WHERE floor_plan_id=$${values.length - 1} AND company_id=$${values.length} RETURNING *`,
      values,
    );
    if (!result.rowCount)
      return NextResponse.json(
        { error: "Floor plan not found" },
        { status: 404 },
      );
    return NextResponse.json({
      message: "Floor plan updated",
      floor_plan: result.rows[0],
    });
  } catch (error) {
    if (inventoryDatabaseError(error) === "23505")
      return NextResponse.json(
        {
          error:
            "This floor plan code and version already exist in the project",
        },
        { status: 409 },
      );
    console.error("Failed to update floor plan", error);
    return NextResponse.json(
      { error: "Unable to update floor plan" },
      { status: 500 },
    );
  }
}
