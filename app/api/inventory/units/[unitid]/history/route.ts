import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getInventoryUnit, parseInventoryUuid } from "@/lib/inventory";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
type Context = { params: Promise<{ unitid: string }> };
export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const unitId = parseInventoryUuid((await context.params).unitid);
  if (!unitId)
    return NextResponse.json(
      { error: "unitId must be a valid UUID" },
      { status: 400 },
    );
  try {
    const unit = await getInventoryUnit(pool, unitId);
    if (!unit)
      return NextResponse.json(
        { error: "Inventory unit not found" },
        { status: 404 },
      );
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(unit.company_id),
        Number(unit.project_id),
      )
    )
      return NextResponse.json(
        { error: "You do not have access to this inventory unit" },
        { status: 403 },
      );
    const result = await pool.query(
      `SELECT history.*,u.first_name AS performed_by_first_name,u.last_name AS performed_by_last_name FROM inventory_unit_status_history history LEFT JOIN users u ON u.user_id=history.performed_by WHERE history.unit_id=$1 ORDER BY history.created_at DESC,history.history_id DESC`,
      [unitId],
    );
    return NextResponse.json({ history: result.rows });
  } catch (error) {
    console.error("Failed to retrieve inventory history", error);
    return NextResponse.json(
      { error: "Unable to retrieve inventory history" },
      { status: 500 },
    );
  }
}
