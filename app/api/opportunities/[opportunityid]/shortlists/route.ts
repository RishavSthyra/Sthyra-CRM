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
      `SELECT s.*, COUNT(*) OVER()::integer AS total
       FROM opportunity_shortlists s
       WHERE s.opportunity_id=$1
       ORDER BY s.updated_at DESC, s.shortlist_id DESC
       LIMIT $2 OFFSET $3`,
      [access.opportunityId, pagination.limit, pagination.offset],
    );
    const total = Number(result.rows[0]?.total ?? 0);
    return NextResponse.json({
      shortlists: result.rows.map((row) => {
        const shortlist = { ...row };
        delete shortlist.total;
        return shortlist;
      }),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve opportunity shortlists", error);
    return NextResponse.json(
      { error: "Unable to retrieve opportunity shortlists" },
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

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const notes =
    body.notes === null || body.notes === undefined
      ? null
      : typeof body.notes === "string"
        ? body.notes.trim() || null
        : undefined;
  const rawUnitIds = Array.isArray(body.unit_ids) ? body.unit_ids : null;
  const unitIds = rawUnitIds
    ? [
        ...new Set(
          rawUnitIds
            .map((item) => (typeof item === "string" ? parseUuid(item) : null))
            .filter((item): item is string => Boolean(item)),
        ),
      ]
    : [];
  const errors: string[] = [];
  if (!title || title.length > 250)
    errors.push("title is required and must not exceed 250 characters");
  if (notes === undefined || (notes && notes.length > 10000))
    errors.push("notes must be text not exceeding 10000 characters");
  if (!rawUnitIds || !rawUnitIds.length)
    errors.push("unit_ids must contain at least one inventory unit");
  if (rawUnitIds && unitIds.length !== rawUnitIds.length)
    errors.push("unit_ids must contain unique valid UUID values");
  if (unitIds.length > 100)
    errors.push("A shortlist cannot contain more than 100 units");
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
    const units = await client.query(
      `SELECT iu.unit_id, iu.unit_code, iu.unit_name, iu.status,
         iu.area_sqft, iu.orientation, ut.type_code, ut.type_name,
         COALESCE(iu.price_override,effective_price.total_amount,ut.base_price) AS amount,
         CASE
           WHEN iu.price_override IS NOT NULL THEN iu.currency
           WHEN effective_price.total_amount IS NOT NULL THEN effective_price.currency
           ELSE ut.currency
         END AS currency,
         CASE
           WHEN iu.price_override IS NOT NULL THEN 'unit_override'
           WHEN effective_price.total_amount IS NOT NULL THEN effective_price.source
           WHEN ut.base_price IS NOT NULL THEN 'unit_type_fallback'
           ELSE NULL
         END AS price_source
       FROM inventory_units iu
       JOIN inventory_unit_types ut ON ut.unit_type_id=iu.unit_type_id
       LEFT JOIN LATERAL (
         SELECT book.currency,
           CASE WHEN entry.unit_id IS NOT NULL THEN 'unit_price_book' ELSE entry.source END AS source,
           entry.base_amount + COALESCE((
             SELECT SUM(component.value::numeric)
             FROM jsonb_each_text(entry.components) component
             WHERE component.value ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
           ),0) AS total_amount
         FROM inventory_price_books book
         JOIN inventory_price_book_entries entry
           ON entry.price_book_id=book.price_book_id
         WHERE book.project_id=iu.project_id
           AND book.is_default=TRUE AND book.is_active=TRUE
           AND (book.valid_from IS NULL OR book.valid_from<=CURRENT_DATE)
           AND (book.valid_until IS NULL OR book.valid_until>=CURRENT_DATE)
           AND (entry.unit_id=iu.unit_id OR
             (entry.unit_id IS NULL AND entry.unit_type_id=iu.unit_type_id))
           AND (entry.valid_from IS NULL OR entry.valid_from<=CURRENT_DATE)
           AND (entry.valid_until IS NULL OR entry.valid_until>=CURRENT_DATE)
         ORDER BY CASE WHEN entry.unit_id=iu.unit_id THEN 0 ELSE 1 END,
           entry.valid_from DESC NULLS LAST, entry.updated_at DESC
         LIMIT 1
       ) effective_price ON TRUE
       WHERE iu.unit_id=ANY($1::uuid[]) AND iu.project_id=$2
         AND iu.company_id=$3 AND iu.archived_at IS NULL
       ORDER BY iu.unit_code`,
      [unitIds, access.opportunity.project_id, access.opportunity.company_id],
    );
    if (units.rowCount !== unitIds.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            "One or more inventory units do not belong to this opportunity's project",
        },
        { status: 422 },
      );
    }

    const items = units.rows.map((unit) => ({
      ...unit,
      amount: unit.amount === null ? null : Number(unit.amount),
      captured_at: new Date().toISOString(),
    }));
    const result = await client.query(
      `INSERT INTO opportunity_shortlists
         (opportunity_id,title,notes,items,created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5)
       RETURNING *`,
      [
        access.opportunityId,
        title,
        notes,
        JSON.stringify(items),
        access.context.userId,
      ],
    );
    await advanceOpportunityToStage(
      client,
      { opportunityId: access.opportunityId },
      "shortlisting",
      "inventory_shortlisted",
      access.context.userId,
    );
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Inventory shortlist created", shortlist: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to create opportunity shortlist", error);
    return NextResponse.json(
      { error: "Unable to create inventory shortlist" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
