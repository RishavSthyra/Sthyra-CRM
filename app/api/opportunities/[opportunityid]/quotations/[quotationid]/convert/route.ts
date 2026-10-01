import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getInventoryUnit, parseInventoryUuid } from "@/lib/inventory";
import {
  changeInventoryUnitStatus,
  InventoryActionError,
} from "@/lib/inventoryActions";
import { queueMarketingConversion } from "@/lib/marketing";
import {
  createNotificationsForUsers,
  resolveNotificationRecipients,
} from "@/lib/notifications";
import { requireOpportunity } from "@/lib/opportunityAccess";
import { advanceOpportunityToStage } from "@/lib/opportunities";
import { parseUuid } from "@/lib/operations";
import { recordQuotationEvent } from "@/lib/quotations";
import { isObject } from "@/utils/isObject";

type Context = {
  params: Promise<{ opportunityid: string; quotationid: string }>;
};

export async function POST(request: NextRequest, context: Context) {
  const params = await context.params;
  const access = await requireOpportunity(request, params.opportunityid);
  if (!access.ok) return access.response;
  const quotationId = parseUuid(params.quotationid);
  if (!quotationId)
    return NextResponse.json(
      { error: "quotationId must be a valid UUID" },
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
  if (!isObject(body) || Array.isArray(body))
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 422 },
    );
  const targetType = body.target_type;
  if (targetType !== "booking" && targetType !== "agreement")
    return NextResponse.json(
      { error: "target_type must be booking or agreement" },
      { status: 422 },
    );
  const unitId =
    targetType === "booking" && typeof body.unit_id === "string"
      ? parseInventoryUuid(body.unit_id)
      : null;
  if (targetType === "booking" && !unitId)
    return NextResponse.json(
      { error: "Select a quoted inventory unit for the booking" },
      { status: 422 },
    );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const quoteResult = await client.query(
      `SELECT * FROM opportunity_quotations
       WHERE quotation_id=$1 AND opportunity_id=$2 FOR UPDATE`,
      [quotationId, access.opportunityId],
    );
    if (!quoteResult.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Quotation not found" },
        { status: 404 },
      );
    }
    const quotation = quoteResult.rows[0];
    if (quotation.status !== "accepted") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Only an accepted quotation can be converted" },
        { status: 409 },
      );
    }
    const existing = await client.query(
      `SELECT * FROM quotation_conversions
       WHERE quotation_id=$1 AND target_type=$2`,
      [quotationId, targetType],
    );
    if (existing.rowCount) {
      await client.query("COMMIT");
      return NextResponse.json({
        message: `Quotation already converted to ${targetType}`,
        conversion: existing.rows[0],
      });
    }

    if (targetType === "agreement") {
      const conversion = await client.query(
        `INSERT INTO quotation_conversions (
           company_id,project_id,opportunity_id,quotation_id,target_type,
           status,snapshot,created_by
         ) VALUES ($1,$2,$3,$4,'agreement','ready',$5::jsonb,$6)
         RETURNING *`,
        [
          quotation.company_id,
          quotation.project_id,
          quotation.opportunity_id,
          quotation.quotation_id,
          JSON.stringify({
            quotation_number: quotation.quotation_number,
            version: quotation.version,
            title: quotation.title,
            currency: quotation.currency,
            line_items: quotation.line_items,
            tax_breakdown: quotation.tax_breakdown,
            payment_plan: quotation.payment_plan,
            total_amount: quotation.total_amount,
            terms_and_conditions: quotation.terms_and_conditions,
          }),
          access.context.userId,
        ],
      );
      await recordQuotationEvent(client, quotation, "agreement_ready", {
        actorUserId: access.context.userId,
        metadata: { conversion_id: conversion.rows[0].conversion_id },
      });
      await client.query("COMMIT");
      return NextResponse.json(
        {
          message: "Agreement-ready snapshot created",
          conversion: conversion.rows[0],
        },
        { status: 201 },
      );
    }

    const quotedUnits = Array.isArray(quotation.line_items)
      ? quotation.line_items
          .map((item: Record<string, unknown>) => item.unit_id)
          .filter(Boolean)
      : [];
    if (!quotedUnits.includes(unitId)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "The selected unit is not part of this quotation" },
        { status: 422 },
      );
    }
    let unit = await getInventoryUnit(client, unitId!, true);
    if (
      !unit ||
      Number(unit.company_id) !== Number(quotation.company_id) ||
      Number(unit.project_id) !== Number(quotation.project_id)
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Quoted inventory unit is unavailable" },
        { status: 409 },
      );
    }
    let reservation = await client.query(
      `SELECT * FROM inventory_reservations
       WHERE unit_id=$1 AND opportunity_id=$2
         AND status IN ('active','converted')
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [unitId, access.opportunityId],
    );
    if (reservation.rows[0]?.status === "converted") {
      const conversion = await client.query(
        `INSERT INTO quotation_conversions (
           company_id,project_id,opportunity_id,quotation_id,target_type,
           reservation_id,status,snapshot,created_by,completed_at
         ) VALUES ($1,$2,$3,$4,'booking',$5,'completed',$6::jsonb,$7,CURRENT_TIMESTAMP)
         RETURNING *`,
        [
          quotation.company_id,
          quotation.project_id,
          quotation.opportunity_id,
          quotation.quotation_id,
          reservation.rows[0].reservation_id,
          JSON.stringify({
            unit_id: unitId,
            total_amount: quotation.total_amount,
          }),
          access.context.userId,
        ],
      );
      await recordQuotationEvent(client, quotation, "booking_created", {
        actorUserId: access.context.userId,
        metadata: { reservation_id: reservation.rows[0].reservation_id },
      });
      await client.query("COMMIT");
      return NextResponse.json({
        message: "Quotation linked to the existing booking",
        conversion: conversion.rows[0],
        booking: reservation.rows[0],
      });
    }

    if (!reservation.rowCount) {
      if (!["available", "held"].includes(String(unit.status))) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: `This unit is ${String(unit.status)} and cannot be booked` },
          { status: 409 },
        );
      }
      let holdId: string | null = null;
      if (unit.status === "held") {
        const hold = await client.query(
          `SELECT * FROM inventory_holds
           WHERE unit_id=$1 AND status='active' FOR UPDATE`,
          [unitId],
        );
        if (
          !hold.rowCount ||
          (hold.rows[0].opportunity_id !== access.opportunityId &&
            hold.rows[0].lead_id !== access.opportunity.lead_id)
        ) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { error: "This unit is held for another customer" },
            { status: 409 },
          );
        }
        holdId = String(hold.rows[0].hold_id);
        await client.query(
          `UPDATE inventory_holds
           SET status='converted',released_at=CURRENT_TIMESTAMP,released_by=$2,
               updated_at=CURRENT_TIMESTAMP WHERE hold_id=$1`,
          [holdId, access.context.userId],
        );
      }
      reservation = await client.query(
        `INSERT INTO inventory_reservations (
           company_id,project_id,unit_id,opportunity_id,hold_id,status,
           reservation_amount,currency,notes,created_by
         ) VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9)
         RETURNING *`,
        [
          quotation.company_id,
          quotation.project_id,
          unitId,
          quotation.opportunity_id,
          holdId,
          quotation.total_amount,
          quotation.currency,
          `Created from accepted quotation ${quotation.quotation_number} V${quotation.version}`,
          access.context.userId,
        ],
      );
      await changeInventoryUnitStatus(client, {
        unitId: unitId!,
        companyId: Number(quotation.company_id),
        projectId: Number(quotation.project_id),
        toStatus: "reserved",
        userId: access.context.userId,
        reason: "Accepted quotation converted to reservation",
        metadata: {
          quotation_id: quotationId,
          reservation_id: reservation.rows[0].reservation_id,
        },
      });
      unit = await getInventoryUnit(client, unitId!, true);
    }
    if (
      reservation.rows[0].status !== "active" ||
      unit?.status !== "reserved"
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "The reservation is not ready for booking" },
        { status: 409 },
      );
    }
    const reservationId = String(reservation.rows[0].reservation_id);
    const bookingReference = `BK-${Date.now().toString(36).toUpperCase()}-${reservationId.slice(0, 6).toUpperCase()}`;
    const booked = await client.query(
      `UPDATE inventory_reservations
       SET status='converted',booking_status='confirmed',
           booking_reference=COALESCE(booking_reference,$2),
           booked_at=CURRENT_TIMESTAMP,booked_by=$3,updated_at=CURRENT_TIMESTAMP
       WHERE reservation_id=$1 RETURNING *`,
      [reservationId, bookingReference, access.context.userId],
    );
    await changeInventoryUnitStatus(client, {
      unitId: unitId!,
      companyId: Number(quotation.company_id),
      projectId: Number(quotation.project_id),
      toStatus: "booked",
      userId: access.context.userId,
      reason: "Accepted quotation converted to booking",
      metadata: { quotation_id: quotationId, reservation_id: reservationId },
    });
    const conversion = await client.query(
      `INSERT INTO quotation_conversions (
         company_id,project_id,opportunity_id,quotation_id,target_type,
         reservation_id,status,snapshot,created_by,completed_at
       ) VALUES ($1,$2,$3,$4,'booking',$5,'completed',$6::jsonb,$7,CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        quotation.company_id,
        quotation.project_id,
        quotation.opportunity_id,
        quotation.quotation_id,
        reservationId,
        JSON.stringify({
          unit_id: unitId,
          total_amount: quotation.total_amount,
        }),
        access.context.userId,
      ],
    );
    await advanceOpportunityToStage(
      client,
      { opportunityId: access.opportunityId },
      "booking",
      "quotation_converted_to_booking",
      access.context.userId,
    );
    await queueMarketingConversion(client, {
      companyId: Number(quotation.company_id),
      projectId: Number(quotation.project_id),
      eventName: "booking_confirmed",
      transactionId: `quotation-booking:${quotationId}`,
      leadId: access.opportunity.lead_id as string,
      opportunityId: access.opportunityId,
      value: Number(quotation.total_amount),
      currency: String(quotation.currency),
    });
    await recordQuotationEvent(client, quotation, "booking_created", {
      actorUserId: access.context.userId,
      metadata: { reservation_id: reservationId, unit_id: unitId },
    });
    const recipients = await resolveNotificationRecipients(client, {
      companyId: Number(quotation.company_id),
      userIds: [
        access.opportunity.current_owner_user_id as string | null,
        access.context.userId,
      ],
      teamIds: [access.opportunity.current_team_id as string | null],
    });
    await createNotificationsForUsers(client, recipients, {
      companyId: Number(quotation.company_id),
      projectId: Number(quotation.project_id),
      type: "quotation.converted_to_booking",
      category: "booking",
      title: "Accepted quotation booked",
      body: `${quotation.quotation_number} was converted to booking ${bookingReference}.`,
      severity: "success",
      entityType: "reservation",
      entityId: reservationId,
      actionUrl: `/opportunities?opportunity_id=${access.opportunityId}`,
      eventKey: `quotation:${quotationId}:booking`,
      metadata: { quotation_id: quotationId, unit_id: unitId },
      channels: ["in_app", "email"],
    });
    await client.query("COMMIT");
    return NextResponse.json(
      {
        message: "Accepted quotation converted to booking",
        conversion: conversion.rows[0],
        booking: booked.rows[0],
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof InventoryActionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("Failed to convert quotation", error);
    return NextResponse.json(
      { error: "Unable to convert quotation" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
