import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseInventoryUuid } from "@/lib/inventory";
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
        { error: `A ${reservation.status} reservation cannot be converted` },
        { status: 409 },
      );
    }
    await client.query(
      "UPDATE inventory_reservations SET status='converted',updated_at=CURRENT_TIMESTAMP WHERE reservation_id=$1",
      [id],
    );
    await changeInventoryUnitStatus(client, {
      unitId: reservation.unit_id,
      companyId: Number(reservation.company_id),
      projectId: Number(reservation.project_id),
      toStatus: "booked",
      userId: scope.context.userId,
      reason: "Reservation converted to booking",
      metadata: {
        reservation_id: id,
        opportunity_id: reservation.opportunity_id,
      },
    });
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Reservation converted; inventory unit is booked",
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof InventoryActionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("Failed to convert reservation", error);
    return NextResponse.json(
      { error: "Unable to convert inventory reservation" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
