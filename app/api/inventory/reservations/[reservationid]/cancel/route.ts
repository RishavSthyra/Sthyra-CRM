import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { isRecord, parseInventoryUuid, textValue } from "@/lib/inventory";
import {
  changeInventoryUnitStatus,
  InventoryActionError,
} from "@/lib/inventoryActions";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
type Context = { params: Promise<{ reservationid: string }> };
export async function POST(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const id = parseInventoryUuid((await context.params).reservationid);
  if (!id)
    return NextResponse.json(
      { error: "reservationId must be a valid UUID" },
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
    const result = await client.query(
      "SELECT * FROM inventory_reservations WHERE reservation_id=$1 FOR UPDATE",
      [id],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Inventory reservation not found" },
        { status: 404 },
      );
    }
    const reservation = result.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(reservation.company_id),
        Number(reservation.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this reservation" },
        { status: 403 },
      );
    }
    if (reservation.status !== "active") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `A ${reservation.status} reservation cannot be cancelled` },
        { status: 409 },
      );
    }
    await client.query(
      `UPDATE inventory_reservations SET status='cancelled',notes=CASE WHEN notes IS NULL THEN $2 ELSE notes || E'\n' || $2 END,cancelled_at=CURRENT_TIMESTAMP,cancelled_by=$3,updated_at=CURRENT_TIMESTAMP WHERE reservation_id=$1`,
      [id, reason, scope.context.userId],
    );
    await changeInventoryUnitStatus(client, {
      unitId: reservation.unit_id,
      companyId: Number(reservation.company_id),
      projectId: Number(reservation.project_id),
      toStatus: "available",
      userId: scope.context.userId,
      reason: reason!,
      metadata: { reservation_id: id, action: "cancel" },
    });
    await client.query("COMMIT");
    return NextResponse.json({ message: "Inventory reservation cancelled" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof InventoryActionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("Failed to cancel reservation", error);
    return NextResponse.json(
      { error: "Unable to cancel inventory reservation" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
