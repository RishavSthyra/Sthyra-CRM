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
import {
  createNotificationsForUsers,
  resolveNotificationRecipients,
} from "@/lib/notifications";
import { advanceOpportunityToStage } from "@/lib/opportunities";
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
    const bookingReference = `BK-${Date.now().toString(36).toUpperCase()}-${id.slice(0, 6).toUpperCase()}`;
    const converted = await client.query(
      `UPDATE inventory_reservations
       SET status='converted', booking_status='confirmed',
           booking_reference=COALESCE(booking_reference,$2),
           booked_at=CURRENT_TIMESTAMP, booked_by=$3,
           updated_at=CURRENT_TIMESTAMP
       WHERE reservation_id=$1
       RETURNING *`,
      [id, bookingReference, scope.context.userId],
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
    const opportunity = await client.query(
      `SELECT current_owner_user_id, current_team_id, opportunity_name
       FROM opportunities WHERE opportunity_id=$1`,
      [reservation.opportunity_id],
    );
    await advanceOpportunityToStage(
      client,
      { opportunityId: reservation.opportunity_id },
      "booking",
      "inventory_booked",
      scope.context.userId,
    );
    const recipients = await resolveNotificationRecipients(client, {
      companyId: Number(reservation.company_id),
      userIds: [
        opportunity.rows[0]?.current_owner_user_id,
        reservation.created_by,
      ],
      teamIds: [opportunity.rows[0]?.current_team_id],
    });
    await createNotificationsForUsers(client, recipients, {
      companyId: Number(reservation.company_id),
      projectId: Number(reservation.project_id),
      type: "booking.created",
      category: "booking",
      title: "Inventory booked",
      body: `A reservation was converted to a booking for ${opportunity.rows[0]?.opportunity_name ?? "an opportunity"}.`,
      severity: "success",
      entityType: "reservation",
      entityId: id,
      actionUrl: `/opportunities?opportunity_id=${reservation.opportunity_id}`,
      eventKey: `reservation:${id}:converted`,
      metadata: {
        unit_id: reservation.unit_id,
        opportunity_id: reservation.opportunity_id,
      },
      channels: ["in_app", "email"],
    });
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Reservation converted; inventory unit is booked",
      booking: converted.rows[0],
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
