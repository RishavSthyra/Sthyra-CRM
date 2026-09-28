import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { isRecord, parseInventoryUuid } from "@/lib/inventory";
import {
  createNotificationsForUsers,
  resolveNotificationRecipients,
} from "@/lib/notifications";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";

type Context = { params: Promise<{ reservationid: string }> };

export async function GET(request: NextRequest, context: Context) {
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
      `SELECT reservation.*, unit.unit_code, unit.unit_name,
         unit_type.type_code, unit_type.type_name,
         opportunity.opportunity_name
       FROM inventory_reservations reservation
       JOIN inventory_units unit ON unit.unit_id=reservation.unit_id
       LEFT JOIN inventory_unit_types unit_type
         ON unit_type.unit_type_id=unit.unit_type_id
       JOIN opportunities opportunity
         ON opportunity.opportunity_id=reservation.opportunity_id
       WHERE reservation.reservation_id=$1`,
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
    return NextResponse.json({ reservation });
  } catch (error) {
    console.error("Failed to retrieve inventory reservation", error);
    return NextResponse.json(
      { error: "Unable to retrieve inventory reservation" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
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

  const allowed = new Set(["amount_paid", "payment_status"]);
  const errors = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .map((key) => `Unknown field: ${key}`);
  const paymentStatuses = new Set(["unpaid", "partial", "paid", "refunded"]);
  const amountPaid = Number(body.amount_paid);
  if (!Number.isFinite(amountPaid) || amountPaid < 0)
    errors.push("amount_paid must be a non-negative number");
  if (!paymentStatuses.has(String(body.payment_status)))
    errors.push(
      "payment_status must be one of: unpaid, partial, paid, refunded",
    );
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT reservation.*, opportunity.current_owner_user_id,
         opportunity.current_team_id, opportunity.opportunity_name
       FROM inventory_reservations reservation
       JOIN opportunities opportunity
         ON opportunity.opportunity_id=reservation.opportunity_id
       WHERE reservation.reservation_id=$1
       FOR UPDATE OF reservation`,
      [reservationId],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Inventory reservation not found" },
        { status: 404 },
      );
    }
    const reservation = current.rows[0];
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
    if (reservation.status !== "converted") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Payment can only be recorded for a confirmed booking" },
        { status: 409 },
      );
    }

    const updated = await client.query(
      `UPDATE inventory_reservations
       SET amount_paid=$2, payment_status=$3,
           payment_updated_at=CURRENT_TIMESTAMP, payment_updated_by=$4,
           updated_at=CURRENT_TIMESTAMP
       WHERE reservation_id=$1
       RETURNING *`,
      [
        reservationId,
        amountPaid,
        String(body.payment_status),
        scope.context.userId,
      ],
    );
    const recipients = await resolveNotificationRecipients(client, {
      companyId: Number(reservation.company_id),
      userIds: [reservation.current_owner_user_id, reservation.created_by],
      teamIds: [reservation.current_team_id],
    });
    await createNotificationsForUsers(client, recipients, {
      companyId: Number(reservation.company_id),
      projectId: Number(reservation.project_id),
      type: "booking.payment_updated",
      category: "booking",
      title: "Booking payment updated",
      body: `${reservation.opportunity_name} is now marked ${String(body.payment_status).replaceAll("_", " ")}.`,
      severity: body.payment_status === "paid" ? "success" : "info",
      entityType: "reservation",
      entityId: reservationId,
      actionUrl: `/opportunities?opportunity_id=${reservation.opportunity_id}`,
      eventKey: `reservation:${reservationId}:payment:${updated.rows[0].updated_at}`,
      metadata: {
        amount_paid: amountPaid,
        payment_status: body.payment_status,
      },
      channels: ["in_app", "email"],
    });
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Booking payment updated",
      reservation: updated.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to update booking payment", error);
    return NextResponse.json(
      { error: "Unable to update booking payment" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
