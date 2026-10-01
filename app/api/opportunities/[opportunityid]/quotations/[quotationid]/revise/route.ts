import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOpportunity } from "@/lib/opportunityAccess";
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
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const reason =
    isObject(body) &&
    !Array.isArray(body) &&
    typeof body.revision_reason === "string"
      ? body.revision_reason.trim().slice(0, 10000) || null
      : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      access.opportunityId,
    ]);
    const sourceResult = await client.query(
      `SELECT * FROM opportunity_quotations
       WHERE quotation_id=$1 AND opportunity_id=$2 FOR UPDATE`,
      [quotationId, access.opportunityId],
    );
    if (!sourceResult.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Quotation not found" },
        { status: 404 },
      );
    }
    const source = sourceResult.rows[0];
    const nextVersion = await client.query(
      `SELECT COALESCE(MAX(version),0)::integer + 1 AS next_version
       FROM opportunity_quotations
       WHERE opportunity_id=$1 AND quotation_number=$2`,
      [access.opportunityId, source.quotation_number],
    );

    const expired = await client.query(
      `UPDATE opportunity_quotations
       SET status='expired',expired_at=COALESCE(expired_at,CURRENT_TIMESTAMP),
           updated_by=$3,updated_at=CURRENT_TIMESTAMP
       WHERE opportunity_id=$1 AND quotation_number=$2
         AND status <> 'expired'
       RETURNING *`,
      [access.opportunityId, source.quotation_number, access.context.userId],
    );
    await client.query(
      `UPDATE quotation_share_links link
       SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP)
       FROM opportunity_quotations quotation
       WHERE link.quotation_id=quotation.quotation_id
         AND quotation.opportunity_id=$1
         AND quotation.quotation_number=$2`,
      [access.opportunityId, source.quotation_number],
    );
    for (const previous of expired.rows) {
      await recordQuotationEvent(client, previous, "expired", {
        actorUserId: access.context.userId,
        comment: "Superseded by a new revision",
      });
    }

    const result = await client.query(
      `INSERT INTO opportunity_quotations (
         company_id,project_id,opportunity_id,parent_quotation_id,
         quotation_number,version,status,title,currency,subtotal,charges_total,
         discount_type,discount_value,discount_amount,tax_amount,total_amount,
         valid_until,line_items,tax_breakdown,payment_plan,terms_and_conditions,
         customer_message,notes,revision_reason,created_by,updated_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
         $17::jsonb,$18::jsonb,$19::jsonb,$20,$21,$22,$23,$24,$24
       ) RETURNING *`,
      [
        source.company_id,
        source.project_id,
        source.opportunity_id,
        source.quotation_id,
        source.quotation_number,
        nextVersion.rows[0].next_version,
        source.title,
        source.currency,
        source.subtotal,
        source.charges_total,
        source.discount_type,
        source.discount_value,
        source.discount_amount,
        source.tax_amount,
        source.total_amount,
        source.valid_until,
        JSON.stringify(source.line_items),
        JSON.stringify(source.tax_breakdown),
        JSON.stringify(source.payment_plan),
        source.terms_and_conditions,
        source.customer_message,
        source.notes,
        reason,
        access.context.userId,
      ],
    );
    await recordQuotationEvent(client, result.rows[0], "revised", {
      actorUserId: access.context.userId,
      comment: reason,
      metadata: { source_quotation_id: quotationId },
    });
    await client.query("COMMIT");
    return NextResponse.json(
      {
        message: `Quotation revision V${result.rows[0].version} created`,
        quotation: result.rows[0],
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to revise quotation", error);
    return NextResponse.json(
      { error: "Unable to create quotation revision" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
