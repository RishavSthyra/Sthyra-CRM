import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOpportunity } from "@/lib/opportunityAccess";
import { parseUuid } from "@/lib/operations";
import {
  getQuotationDetail,
  recordQuotationEvent,
  validateQuotationInput,
} from "@/lib/quotations";

type Context = {
  params: Promise<{ opportunityid: string; quotationid: string }>;
};

export async function GET(request: NextRequest, context: Context) {
  const params = await context.params;
  const access = await requireOpportunity(request, params.opportunityid);
  if (!access.ok) return access.response;
  const quotationId = parseUuid(params.quotationid);
  if (!quotationId)
    return NextResponse.json(
      { error: "quotationId must be a valid UUID" },
      { status: 400 },
    );
  try {
    const [quotation, events] = await Promise.all([
      getQuotationDetail(pool, quotationId, access.opportunityId),
      pool.query(
        `SELECT event.*, COALESCE(
           NULLIF(BTRIM(CONCAT(actor.first_name, ' ', actor.last_name)), ''),
           event.actor_name, event.actor_email
         ) AS actor_display_name
         FROM opportunity_quotation_events event
         LEFT JOIN users actor ON actor.user_id=event.actor_user_id
         WHERE event.quotation_id=$1
         ORDER BY event.created_at DESC, event.quotation_event_id DESC`,
        [quotationId],
      ),
    ]);
    if (!quotation)
      return NextResponse.json(
        { error: "Quotation not found" },
        { status: 404 },
      );
    const response = NextResponse.json({ quotation, events: events.rows });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Failed to retrieve quotation", error);
    return NextResponse.json(
      { error: "Unable to retrieve quotation" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
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
  const validation = validateQuotationInput(body);
  if (!validation.ok)
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      `SELECT * FROM opportunity_quotations
       WHERE quotation_id=$1 AND opportunity_id=$2 FOR UPDATE`,
      [quotationId, access.opportunityId],
    );
    if (!currentResult.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Quotation not found" },
        { status: 404 },
      );
    }
    const current = currentResult.rows[0];
    if (current.status !== "draft") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            "Only draft quotations can be edited. Create a revision to change a sent or completed quotation.",
        },
        { status: 409 },
      );
    }
    const { data, amounts } = validation;
    const result = await client.query(
      `UPDATE opportunity_quotations SET
         title=$3,currency=$4,subtotal=$5,charges_total=$6,
         discount_type=$7,discount_value=$8,discount_amount=$9,
         tax_amount=$10,total_amount=$11,valid_until=$12,line_items=$13::jsonb,
         tax_breakdown=$14::jsonb,payment_plan=$15::jsonb,
         terms_and_conditions=$16,customer_message=$17,notes=$18,
         updated_by=$19,updated_at=CURRENT_TIMESTAMP
       WHERE quotation_id=$1 AND opportunity_id=$2
       RETURNING *`,
      [
        quotationId,
        access.opportunityId,
        data.title,
        data.currency,
        amounts.subtotal,
        amounts.chargesTotal,
        data.discount_type,
        data.discount_value,
        amounts.discountAmount,
        amounts.taxAmount,
        amounts.totalAmount,
        data.valid_until,
        JSON.stringify(data.line_items),
        JSON.stringify(amounts.taxes),
        JSON.stringify(amounts.paymentPlan),
        data.terms_and_conditions,
        data.customer_message,
        data.notes,
        access.context.userId,
      ],
    );
    await recordQuotationEvent(client, result.rows[0], "updated", {
      actorUserId: access.context.userId,
    });
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Quotation draft updated",
      quotation: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to update quotation", error);
    return NextResponse.json(
      { error: "Unable to update quotation" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
