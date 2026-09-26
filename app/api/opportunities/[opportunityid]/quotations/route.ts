import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOpportunity } from "@/lib/opportunityAccess";
import { advanceOpportunityToStage } from "@/lib/opportunities";
import { parseUuid } from "@/lib/operations";
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
      `SELECT q.*, COUNT(*) OVER()::integer AS total
       FROM opportunity_quotations q
       WHERE q.opportunity_id=$1
       ORDER BY q.created_at DESC, q.quotation_id DESC
       LIMIT $2 OFFSET $3`,
      [access.opportunityId, pagination.limit, pagination.offset],
    );
    const total = Number(result.rows[0]?.total ?? 0);
    return NextResponse.json({
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

  const shortlistId =
    typeof body.shortlist_id === "string" ? parseUuid(body.shortlist_id) : null;
  const notes =
    body.notes === null || body.notes === undefined
      ? null
      : typeof body.notes === "string"
        ? body.notes.trim() || null
        : undefined;
  const validUntil =
    body.valid_until === null || body.valid_until === undefined
      ? null
      : typeof body.valid_until === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(body.valid_until) &&
          !Number.isNaN(Date.parse(`${body.valid_until}T00:00:00Z`))
        ? body.valid_until
        : undefined;
  const taxAmount = body.tax_amount === undefined ? 0 : Number(body.tax_amount);
  const errors: string[] = [];
  if (!shortlistId) errors.push("shortlist_id must be a valid UUID");
  if (notes === undefined || (notes && notes.length > 10000))
    errors.push("notes must be text not exceeding 10000 characters");
  if (validUntil === undefined)
    errors.push("valid_until must be a valid YYYY-MM-DD date or null");
  if (!Number.isFinite(taxAmount) || taxAmount < 0)
    errors.push("tax_amount must be a non-negative number");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT opportunity_id FROM opportunities WHERE opportunity_id=$1 FOR UPDATE",
      [access.opportunityId],
    );
    const shortlist = await client.query(
      `SELECT * FROM opportunity_shortlists
       WHERE shortlist_id=$1 AND opportunity_id=$2`,
      [shortlistId, access.opportunityId],
    );
    if (!shortlist.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Shortlist not found for this opportunity" },
        { status: 404 },
      );
    }

    const lineItems = Array.isArray(shortlist.rows[0].items)
      ? (shortlist.rows[0].items as Array<Record<string, unknown>>)
      : [];
    if (!lineItems.length || lineItems.some((item) => item.amount === null)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            "Every shortlisted unit needs an effective price before creating a quotation",
        },
        { status: 409 },
      );
    }
    const currencies = new Set(lineItems.map((item) => String(item.currency)));
    if (currencies.size !== 1) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "All shortlisted units must use the same currency" },
        { status: 409 },
      );
    }
    const subtotal = lineItems.reduce(
      (sum, item) => sum + Number(item.amount ?? 0),
      0,
    );
    const sequence = await client.query(
      `SELECT COUNT(*)::integer + 1 AS next_number
       FROM opportunity_quotations WHERE opportunity_id=$1`,
      [access.opportunityId],
    );
    const quotationNumber = `Q-${String(access.opportunityId).slice(0, 8).toUpperCase()}-${String(sequence.rows[0].next_number).padStart(2, "0")}`;
    const result = await client.query(
      `INSERT INTO opportunity_quotations (
         opportunity_id,quotation_number,currency,subtotal,tax_amount,
         total_amount,valid_until,line_items,notes,created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
       RETURNING *`,
      [
        access.opportunityId,
        quotationNumber,
        [...currencies][0],
        subtotal,
        taxAmount,
        subtotal + taxAmount,
        validUntil,
        JSON.stringify(lineItems),
        notes,
        access.context.userId,
      ],
    );
    await advanceOpportunityToStage(
      client,
      { opportunityId: access.opportunityId },
      "proposal",
      "quotation_created",
      access.context.userId,
    );
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Quotation created", quotation: result.rows[0] },
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
