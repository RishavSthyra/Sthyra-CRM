import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getInventoryUnit,
  isRecord,
  parseInventoryUuid,
  textValue,
} from "@/lib/inventory";
import {
  changeInventoryUnitStatus,
  InventoryActionError,
} from "@/lib/inventoryActions";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
type Context = { params: Promise<{ unitid: string }> };
export async function POST(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const unitId = parseInventoryUuid((await context.params).unitid);
  if (!unitId)
    return NextResponse.json(
      { error: "unitId must be a valid UUID" },
      { status: 400 },
    );
  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
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
  const reason = textValue(body.reason, "reason", errors, {
    nullable: true,
    maximum: 5000,
  });
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const unit = await getInventoryUnit(client, unitId, true);
    if (!unit) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Inventory unit not found" },
        { status: 404 },
      );
    }
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(unit.company_id),
        Number(unit.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this inventory unit" },
        { status: 403 },
      );
    }
    if (unit.status !== "held") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: `Only held inventory can be released; this unit is ${unit.status}`,
        },
        { status: 409 },
      );
    }
    const hold = await client.query(
      `UPDATE inventory_holds SET status='released',released_at=CURRENT_TIMESTAMP,released_by=$2,updated_at=CURRENT_TIMESTAMP WHERE unit_id=$1 AND status='active' RETURNING *`,
      [unitId, scope.context.userId],
    );
    if (!hold.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "No active hold exists for this unit" },
        { status: 409 },
      );
    }
    await changeInventoryUnitStatus(client, {
      unitId,
      companyId: Number(unit.company_id),
      projectId: Number(unit.project_id),
      toStatus: "available",
      userId: scope.context.userId,
      reason: reason ?? "Hold released",
      metadata: { hold_id: hold.rows[0].hold_id },
    });
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Inventory hold released",
      hold: hold.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof InventoryActionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("Failed to release inventory hold", error);
    return NextResponse.json(
      { error: "Unable to release inventory hold" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
