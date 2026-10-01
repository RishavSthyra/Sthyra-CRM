import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOpportunity } from "@/lib/opportunityAccess";
import { advanceOpportunityToStage } from "@/lib/opportunities";
import { recordQuotationEvent, validateQuotationInput } from "@/lib/quotations";
import {
  createNotificationsForUsers,
  resolveNotificationRecipients,
} from "@/lib/notifications";
import { isObject } from "@/utils/isObject";
import { parsePagination } from "@/utils/parsePagination";

type Context = { params: Promise<{ opportunityid: string }> };

export async function GET(request: NextRequest, context: Context) {
  const access = await requireOpportunity(
    request,
    (await context.params).opportunityid,
  );
  if (!access.ok) return access.response;
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok)
    return NextResponse.json({ error: pagination.error }, { status: 400 });

  try {
    const result = await pool.query(
      `SELECT quotation.*,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'conversion_id', conversion.conversion_id,
             'target_type', conversion.target_type,
             'status', conversion.status,
             'reservation_id', conversion.reservation_id,
             'created_at', conversion.created_at,
             'completed_at', conversion.completed_at
           ) ORDER BY conversion.created_at)
           FROM quotation_conversions conversion
           WHERE conversion.quotation_id=quotation.quotation_id
         ), '[]'::jsonb) AS conversions,
         COUNT(*) OVER()::integer AS total
       FROM opportunity_quotations quotation
       WHERE quotation.opportunity_id=$1
       ORDER BY quotation.created_at DESC, quotation.quotation_id DESC
       LIMIT $2 OFFSET $3`,
      [access.opportunityId, pagination.limit, pagination.offset],
    );
    const total = Number(result.rows[0]?.total ?? 0);
    const response = NextResponse.json({
      quotations: result.rows.map((row) => {
        const quotation = { ...row };
        delete quotation.total;
        return quotation;
      }),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Failed to retrieve opportunity quotations", error);
    return NextResponse.json(
      { error: "Unable to retrieve opportunity quotations" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: Context) {
  const access = await requireOpportunity(
    request,
    (await context.params).opportunityid,
  );
  if (!access.ok) return access.response;

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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      access.opportunityId,
    ]);

    let shortlist: Record<string, unknown> | null = null;
    if (typeof body.shortlist_id === "string") {
      const shortlistResult = await client.query(
        `SELECT * FROM opportunity_shortlists
         WHERE shortlist_id=$1 AND opportunity_id=$2`,
        [body.shortlist_id, access.opportunityId],
      );
      if (!shortlistResult.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Shortlist not found for this opportunity" },
          { status: 404 },
        );
      }
      shortlist = shortlistResult.rows[0];
    }

    const sourceItems = Array.isArray(body.line_items)
      ? body.line_items
      : Array.isArray(shortlist?.items)
        ? (shortlist.items as Array<Record<string, unknown>>).map((item) => ({
            ...item,
            category: "base_price",
            description:
              item.unit_name ||
              item.unit_code ||
              item.type_name ||
              "Inventory unit",
            quantity: 1,
            unit_price: item.amount,
          }))
        : null;
    if (!sourceItems) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Provide line_items or a valid shortlist_id" },
        { status: 422 },
      );
    }

    const inferredCurrency = String(
      body.currency ||
        (sourceItems[0] as Record<string, unknown> | undefined)?.currency ||
        "INR",
    );
    const rawTaxAmount = Number(body.tax_amount || 0);
    const rawSubtotal = sourceItems.reduce(
      (sum, item) =>
        sum +
        Number(
          (item as Record<string, unknown>).amount ??
            (item as Record<string, unknown>).unit_price ??
            0,
        ),
      0,
    );
    const normalizedBody = {
      ...body,
      title:
        typeof body.title === "string"
          ? body.title
          : shortlist?.title
            ? `${String(shortlist.title)} quotation`
            : "Customer quotation",
      currency: inferredCurrency,
      line_items: sourceItems,
      discount_type: body.discount_type ?? null,
      discount_value: body.discount_value ?? 0,
      tax_breakdown:
        body.tax_breakdown ??
        (rawTaxAmount > 0 && rawSubtotal > 0
          ? [{ label: "Tax", rate: (rawTaxAmount / rawSubtotal) * 100 }]
          : []),
      payment_plan: body.payment_plan ?? {
        template_key: "full",
        template_name: "Full payment",
        installments: [
          { label: "Full payment", percentage: 100, due_date: null },
        ],
      },
      terms_and_conditions: body.terms_and_conditions ?? null,
      customer_message: body.customer_message ?? null,
    };
    const validation = validateQuotationInput(normalizedBody);
    if (!validation.ok) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Validation failed", details: validation.errors },
        { status: 422 },
      );
    }

    const sequence = await client.query(
      `SELECT COUNT(DISTINCT quotation_number)::integer + 1 AS next_number
       FROM opportunity_quotations WHERE opportunity_id=$1`,
      [access.opportunityId],
    );
    const quotationNumber = `Q-${String(access.opportunityId)
      .slice(0, 8)
      .toUpperCase()}-${String(sequence.rows[0].next_number).padStart(2, "0")}`;
    const { data, amounts } = validation;
    const result = await client.query(
      `INSERT INTO opportunity_quotations (
         company_id,project_id,opportunity_id,quotation_number,version,status,
         title,currency,subtotal,charges_total,discount_type,discount_value,
         discount_amount,tax_amount,total_amount,valid_until,line_items,
         tax_breakdown,payment_plan,terms_and_conditions,customer_message,
         notes,created_by,updated_by
       ) VALUES (
         $1,$2,$3,$4,1,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
         $15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20,$21,$21
       ) RETURNING *`,
      [
        access.opportunity.company_id,
        access.opportunity.project_id,
        access.opportunityId,
        quotationNumber,
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
    const quotation = result.rows[0];
    await recordQuotationEvent(client, quotation, "created", {
      actorUserId: access.context.userId,
      metadata: { shortlist_id: shortlist?.shortlist_id ?? null },
    });
    await advanceOpportunityToStage(
      client,
      { opportunityId: access.opportunityId },
      "proposal",
      "quotation_created",
      access.context.userId,
    );
    const recipients = await resolveNotificationRecipients(client, {
      companyId: Number(access.opportunity.company_id),
      userIds: [access.opportunity.current_owner_user_id as string | null],
      teamIds: [access.opportunity.current_team_id as string | null],
    });
    await createNotificationsForUsers(client, recipients, {
      companyId: Number(access.opportunity.company_id),
      projectId: Number(access.opportunity.project_id),
      type: "quotation.created",
      category: "quotation",
      title: "Quotation created",
      body: `${quotationNumber} is ready for ${access.opportunity.opportunity_name}.`,
      entityType: "quotation",
      entityId: String(quotation.quotation_id),
      actionUrl: `/opportunities?opportunity_id=${access.opportunityId}`,
      eventKey: `quotation:${quotation.quotation_id}:created`,
      metadata: {
        opportunity_id: access.opportunityId,
        total_amount: amounts.totalAmount,
      },
      channels: ["in_app", "email"],
    });
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Quotation draft created", quotation },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to create opportunity quotation", error);
    return NextResponse.json(
      { error: "Unable to create quotation" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
