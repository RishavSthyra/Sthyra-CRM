import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { BOOKING_WORKFLOW_ERRORS } from "@/lib/bookingWorkflow";
import { parseInventoryUuid } from "@/lib/inventory";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";

type Context = { params: Promise<{ reservationid: string }> };

export async function POST(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;

  const reservationId = parseInventoryUuid(
    (await context.params).reservationid,
  );
  if (!reservationId)
    return NextResponse.json(
      { error: "reservationId must be a valid UUID" },
      { status: 400 },
    );

  try {
    const result = await pool.query(
      `SELECT company_id,project_id
       FROM inventory_reservations
       WHERE reservation_id=$1`,
      [reservationId],
    );
    if (!result.rowCount)
      return NextResponse.json(
        { error: "Inventory reservation not found" },
        { status: 404 },
      );

    const reservation = result.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(reservation.company_id),
        Number(reservation.project_id),
      )
    )
      return NextResponse.json(
        { error: "You do not have access to this reservation" },
        { status: 403 },
      );

    return NextResponse.json(
      { error: BOOKING_WORKFLOW_ERRORS.directConfirmationDisabled },
      { status: 409 },
    );
  } catch (error) {
    console.error("Failed to validate inventory reservation", error);
    return NextResponse.json(
      { error: "Unable to validate inventory reservation" },
      { status: 500 },
    );
  }
}
