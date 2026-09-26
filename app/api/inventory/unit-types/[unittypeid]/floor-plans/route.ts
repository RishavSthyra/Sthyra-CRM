import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  isRecord,
  numberValue,
  parseInventoryUuid,
  textValue,
  uuidValue,
} from "@/lib/inventory";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
type Context = { params: Promise<{ unittypeid: string }> };
export async function PUT(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const id = parseInventoryUuid((await context.params).unittypeid);
  if (!id)
    return NextResponse.json(
      { error: "unitTypeId must be a valid UUID" },
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
  if (!isRecord(body) || !Array.isArray(body.floor_plans))
    return NextResponse.json(
      { error: "floor_plans must be an array" },
      { status: 422 },
    );
  const errors: string[] = [];
  const plans: {
    floor_plan_id: string;
    plan_role: string;
    display_order: number;
  }[] = [];
  body.floor_plans.forEach((raw, index) => {
    if (!isRecord(raw)) {
      errors.push(`floor_plans[${index}] must be an object`);
      return;
    }
    const planId = uuidValue(
      raw.floor_plan_id,
      `floor_plans[${index}].floor_plan_id`,
      errors,
    );
    const role =
      textValue(raw.plan_role, `floor_plans[${index}].plan_role`, errors, {
        maximum: 40,
      }) ?? (index === 0 ? "primary" : "alternate");
    const order =
      numberValue(
        raw.display_order,
        `floor_plans[${index}].display_order`,
        errors,
        { minimum: 1, integer: true },
      ) ?? index + 1;
    if (planId)
      plans.push({
        floor_plan_id: planId,
        plan_role: role,
        display_order: order,
      });
  });
  if (new Set(plans.map((plan) => plan.floor_plan_id)).size !== plans.length)
    errors.push("floor_plans cannot contain duplicate floor_plan_id values");
  if (plans.filter((plan) => plan.plan_role === "primary").length > 1)
    errors.push("Only one floor plan can be primary");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const type = await client.query(
      "SELECT * FROM inventory_unit_types WHERE unit_type_id=$1 FOR UPDATE",
      [id],
    );
    if (!type.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Inventory unit type not found" },
        { status: 404 },
      );
    }
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(type.rows[0].company_id),
        Number(type.rows[0].project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this inventory unit type" },
        { status: 403 },
      );
    }
    if (plans.length) {
      const valid = await client.query(
        "SELECT floor_plan_id FROM inventory_floor_plans WHERE company_id=$1 AND project_id=$2 AND floor_plan_id=ANY($3::uuid[])",
        [
          type.rows[0].company_id,
          type.rows[0].project_id,
          plans.map((plan) => plan.floor_plan_id),
        ],
      );
      if (valid.rowCount !== plans.length) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Every floor plan must belong to the unit type project" },
          { status: 422 },
        );
      }
    }
    await client.query(
      "DELETE FROM inventory_unit_type_floor_plans WHERE unit_type_id=$1",
      [id],
    );
    for (const plan of plans)
      await client.query(
        "INSERT INTO inventory_unit_type_floor_plans (unit_type_id,floor_plan_id,plan_role,display_order) VALUES ($1,$2,$3,$4)",
        [id, plan.floor_plan_id, plan.plan_role, plan.display_order],
      );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Unit type floor plans replaced",
      floor_plans: plans,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to replace unit type floor plans", error);
    return NextResponse.json(
      { error: "Unable to replace unit type floor plans" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
