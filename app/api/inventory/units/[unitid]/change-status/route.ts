import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getInventoryUnit,
  isInventoryStatus,
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
  if (!isInventoryStatus(body.status))
    return NextResponse.json(
      { error: "Invalid inventory status" },
      { status: 422 },
    );
  if (["held", "reserved", "booked"].includes(body.status))
    return NextResponse.json(
      {
        error:
          "Use the hold, reserve, or reservation conversion endpoint for this status",
      },
      { status: 422 },
    );
  const errors: string[] = [];
  const reason = textValue(body.reason, "reason", errors, {
    required: true,
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
    if (["held", "reserved"].includes(String(unit.status))) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            "Release the active hold or cancel/convert the reservation before changing status",
        },
        { status: 409 },
      );
    }
    const updated = await changeInventoryUnitStatus(client, {
      unitId,
      companyId: Number(unit.company_id),
      projectId: Number(unit.project_id),
      toStatus: body.status,
      userId: scope.context.userId,
      reason: reason!,
      metadata: { source: "manual_status_change" },
    });
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Inventory status changed",
      unit: updated,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof InventoryActionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("Failed to change inventory status", error);
    return NextResponse.json(
      { error: "Unable to change inventory status" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
