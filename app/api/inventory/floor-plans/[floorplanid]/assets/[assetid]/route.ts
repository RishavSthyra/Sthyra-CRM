import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseInventoryUuid } from "@/lib/inventory";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
type Context = { params: Promise<{ floorplanid: string; assetid: string }> };
export async function DELETE(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const params = await context.params;
  const planId = parseInventoryUuid(params.floorplanid);
  const assetId = parseInventoryUuid(params.assetid);
  if (!planId || !assetId)
    return NextResponse.json(
      { error: "floorPlanId and assetId must be valid UUIDs" },
      { status: 400 },
    );
  try {
    const plan = await pool.query(
      "SELECT * FROM inventory_floor_plans WHERE floor_plan_id=$1",
      [planId],
    );
    if (!plan.rowCount)
      return NextResponse.json(
        { error: "Floor plan not found" },
        { status: 404 },
      );
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(plan.rows[0].company_id),
        Number(plan.rows[0].project_id),
      )
    )
      return NextResponse.json(
        { error: "You do not have access to this floor plan" },
        { status: 403 },
      );
    const result = await pool.query(
      "DELETE FROM inventory_floor_plan_assets WHERE asset_id=$1 AND floor_plan_id=$2 RETURNING asset_id",
      [assetId, planId],
    );
    if (!result.rowCount)
      return NextResponse.json(
        { error: "Floor plan asset not found" },
        { status: 404 },
      );
    return NextResponse.json({ message: "Floor plan asset removed" });
  } catch (error) {
    console.error("Failed to remove floor plan asset", error);
    return NextResponse.json(
      { error: "Unable to remove floor plan asset" },
      { status: 500 },
    );
  }
}
