import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  bookingFormUrl,
  createBookingCommercialSnapshot,
  createBookingFormToken,
  createBookingReference,
  getBookingFormDetail,
} from "@/lib/bookingForms";
import { parseInventoryUuid } from "@/lib/inventory";
import { requireOpportunity } from "@/lib/opportunityAccess";
import { parseUuid } from "@/lib/operations";
import { recordQuotationEvent } from "@/lib/quotations";
import { isObject } from "@/utils/isObject";

type Context = {
  params: Promise<{ opportunityid: string; quotationid: string }>;
};

function publicSummary(form: Record<string, unknown> | null) {
  if (!form) return null;
  const expired =
    form.status === "active" && new Date(String(form.expires_at)) <= new Date();
  return {
    booking_form_id: form.booking_form_id,
    booking_reference: form.booking_reference,
    status: expired ? "expired" : form.status,
    unit_id: form.unit_id,
    configuration: form.configuration,
    flat_number: form.flat_number,
    agreed_price: form.agreed_price,
    booking_amount: form.booking_amount,
    currency: form.currency,
    expires_at: form.expires_at,
    first_viewed_at: form.first_viewed_at,
    last_viewed_at: form.last_viewed_at,
    view_count: form.view_count,
    submitted_at: form.submitted_at,
    confirmed_at: form.confirmed_at,
    customer_name: form.customer_name,
    phone_number: form.phone_number,
  };
}

async function resolveRequest(request: NextRequest, context: Context) {
  const params = await context.params;
  const access = await requireOpportunity(request, params.opportunityid);
  if (!access.ok) return access;
  const quotationId = parseUuid(params.quotationid);
  if (!quotationId)
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "quotationId must be a valid UUID" },
        { status: 400 },
      ),
    };
  return { ok: true as const, access, quotationId };
}

export async function GET(request: NextRequest, context: Context) {
  const resolved = await resolveRequest(request, context);
  if (!resolved.ok) return resolved.response;
  try {
    const form = await getBookingFormDetail(
      pool,
      resolved.quotationId,
      resolved.access.opportunityId,
    );
    const response = NextResponse.json({ booking_form: publicSummary(form) });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Failed to retrieve booking form", error);
    return NextResponse.json(
      { error: "Unable to retrieve booking form" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: Context) {
  const resolved = await resolveRequest(request, context);
  if (!resolved.ok) return resolved.response;
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const input = isObject(body) && !Array.isArray(body) ? body : {};
  const requestedUnitId =
    typeof input.unit_id === "string"
      ? parseInventoryUuid(input.unit_id)
      : null;
  if (input.unit_id !== undefined && !requestedUnitId)
    return NextResponse.json(
      { error: "unit_id must be a valid inventory unit UUID" },
      { status: 422 },
    );
  const validityDays =
    Number.isSafeInteger(input.validity_days) && Number(input.validity_days) > 0
      ? Math.min(90, Number(input.validity_days))
      : 14;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const quoteResult = await client.query(
      `SELECT quotation.*, opportunity.stage_key, opportunity.status AS opportunity_status,
              opportunity.opportunity_name, contact.first_name, contact.last_name,
              contact.phone_number AS contact_phone_number
       FROM opportunity_quotations quotation
       JOIN opportunities opportunity ON opportunity.opportunity_id=quotation.opportunity_id
       JOIN contacts contact ON contact.contact_id=opportunity.contact_id
       WHERE quotation.quotation_id=$1 AND quotation.opportunity_id=$2
       FOR UPDATE OF quotation,opportunity`,
      [resolved.quotationId, resolved.access.opportunityId],
    );
    if (!quoteResult.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
    }
    const quotation = quoteResult.rows[0] as Record<string, unknown>;
    if (quotation.status !== "accepted") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Accept the quotation before creating a booking form" },
        { status: 409 },
      );
    }
    if (quotation.opportunity_status !== "open") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "A booking form cannot be created for a closed opportunity" },
        { status: 409 },
      );
    }
    if (quotation.stage_key !== "booking") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Move this opportunity to the Booking stage first" },
        { status: 409 },
      );
    }
    const existingResult = await client.query(
      "SELECT * FROM booking_forms WHERE quotation_id=$1 FOR UPDATE",
      [resolved.quotationId],
    );
    const existing = existingResult.rows[0] as
      | Record<string, unknown>
      | undefined;
    if (existing?.status === "submitted" || existing?.status === "confirmed") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This booking form has already been submitted" },
        { status: 409 },
      );
    }

    const quotedUnitIds = Array.from(
      new Set(
        (Array.isArray(quotation.line_items) ? quotation.line_items : [])
          .map((item) =>
            isObject(item) && typeof item.unit_id === "string"
              ? item.unit_id
              : null,
          )
          .filter((value): value is string => Boolean(value)),
      ),
    );
    if (!quotedUnitIds.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This quotation has no inventory unit for the booking form" },
        { status: 422 },
      );
    }
    const unitId = requestedUnitId ??
      (quotedUnitIds.length === 1 ? quotedUnitIds[0] : null);
    if (!unitId) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Select one of the quoted units for this booking form" },
        { status: 422 },
      );
    }
    if (!quotedUnitIds.includes(unitId)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "The selected unit is not part of this quotation" },
        { status: 422 },
      );
    }
    const unitResult = await client.query(
      `SELECT unit.unit_id,unit.unit_code,unit.unit_name,unit.company_id,unit.project_id,
              unit.archived_at,unit_type.type_name,unit_type.configuration
       FROM inventory_units unit
       LEFT JOIN inventory_unit_types unit_type ON unit_type.unit_type_id=unit.unit_type_id
       WHERE unit.unit_id=$1 FOR UPDATE OF unit`,
      [unitId],
    );
    const unit = unitResult.rows[0] as Record<string, unknown> | undefined;
    if (
      !unit ||
      unit.archived_at ||
      Number(unit.company_id) !== Number(quotation.company_id) ||
      Number(unit.project_id) !== Number(quotation.project_id)
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "The quoted inventory unit is no longer available" },
        { status: 409 },
      );
    }
    const snapshot = createBookingCommercialSnapshot({ quotation, unit });
    const customerName =
      `${String(quotation.first_name ?? "")} ${String(quotation.last_name ?? "")}`.trim() ||
      String(quotation.opportunity_name ?? "Customer");
    const { token, tokenHash } = createBookingFormToken();
    const values = [
      quotation.company_id,
      quotation.project_id,
      quotation.opportunity_id,
      quotation.quotation_id,
      unitId,
      tokenHash,
      customerName,
      quotation.contact_phone_number ?? null,
      snapshot.configuration,
      snapshot.flatNumber,
      snapshot.agreedPrice,
      snapshot.bookingAmount,
      snapshot.currency,
      JSON.stringify(snapshot.paymentPlan),
      validityDays,
      resolved.access.context.userId,
    ];
    const formResult = existing
      ? await client.query(
          `UPDATE booking_forms SET
             unit_id=$5,token_hash=$6,status='active',customer_name=$7,phone_number=$8,
             configuration=$9,flat_number=$10,agreed_price=$11,booking_amount=$12,
             currency=$13,payment_plan=$14::jsonb,
             expires_at=CURRENT_TIMESTAMP + ($15 * INTERVAL '1 day'),
             first_viewed_at=NULL,last_viewed_at=NULL,view_count=0,
             submitted_at=NULL,acknowledged_at=NULL,confirmed_at=NULL,confirmed_by=NULL,revoked_at=NULL,
             updated_at=CURRENT_TIMESTAMP
           WHERE quotation_id=$4 RETURNING *`,
          values.slice(0, 15),
        )
      : await client.query(
          `INSERT INTO booking_forms (
             booking_reference,company_id,project_id,opportunity_id,quotation_id,
             unit_id,token_hash,customer_name,phone_number,configuration,flat_number,
             agreed_price,booking_amount,currency,payment_plan,expires_at,created_by
           ) VALUES (
             $17,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,
             CURRENT_TIMESTAMP + ($15 * INTERVAL '1 day'),$16
           ) RETURNING *`,
          [...values, createBookingReference()],
        );
    const form = formResult.rows[0] as Record<string, unknown>;
    await recordQuotationEvent(client, quotation, "booking_form_created", {
      actorUserId: resolved.access.context.userId,
      comment: existing
        ? "Secure booking form link regenerated"
        : "Secure booking form created",
      metadata: {
        booking_form_id: form.booking_form_id,
        unit_id: unitId,
        expires_at: form.expires_at,
      },
    });
    await client.query("COMMIT");
    return NextResponse.json(
      {
        message: existing
          ? "Secure booking form link regenerated"
          : "Secure booking form created",
        booking_form: publicSummary(form),
        share_url: bookingFormUrl(token, request.nextUrl.origin),
      },
      { status: existing ? 200 : 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to create booking form", error);
    return NextResponse.json(
      { error: "Unable to create booking form" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const resolved = await resolveRequest(request, context);
  if (!resolved.ok) return resolved.response;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT form.*
       FROM booking_forms form
       WHERE form.quotation_id=$1 AND form.opportunity_id=$2
       FOR UPDATE`,
      [resolved.quotationId, resolved.access.opportunityId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Booking form not found" }, { status: 404 });
    }
    const form = result.rows[0] as Record<string, unknown>;
    if (form.status === "submitted" || form.status === "confirmed") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "A submitted booking form cannot be revoked" },
        { status: 409 },
      );
    }
    const updated = await client.query(
      `UPDATE booking_forms SET status='revoked',revoked_at=CURRENT_TIMESTAMP,
              updated_at=CURRENT_TIMESTAMP
       WHERE booking_form_id=$1 RETURNING *`,
      [form.booking_form_id],
    );
    await recordQuotationEvent(client, form, "booking_form_revoked", {
      actorUserId: resolved.access.context.userId,
      metadata: { booking_form_id: form.booking_form_id },
    });
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Booking form link revoked",
      booking_form: publicSummary(updated.rows[0]),
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to revoke booking form", error);
    return NextResponse.json(
      { error: "Unable to revoke booking form" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
