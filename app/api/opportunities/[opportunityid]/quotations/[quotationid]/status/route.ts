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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  if (!isObject(body) || Array.isArray(body) || body.action !== "cancel")
    return NextResponse.json(
      { error: "action must be cancel" },
      { status: 422 },
    );
  const comment =
    typeof body.comment === "string" ? body.comment.trim().slice(0, 10000) : "";
  if (!comment)
    return NextResponse.json(
      { error: "A cancellation reason is required" },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT * FROM opportunity_quotations
       WHERE quotation_id=$1 AND opportunity_id=$2 FOR UPDATE`,
      [quotationId, access.opportunityId],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Quotation not found" },
        { status: 404 },
      );
    }
    if (["cancelled", "expired", "rejected"].includes(current.rows[0].status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `This quotation is already ${current.rows[0].status}` },
        { status: 409 },
      );
    }
    const result = await client.query(
      `UPDATE opportunity_quotations
       SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancelled_by=$2,
           updated_by=$2,updated_at=CURRENT_TIMESTAMP
       WHERE quotation_id=$1 RETURNING *`,
      [quotationId, access.context.userId],
    );
    await client.query(
      `UPDATE quotation_share_links
       SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP)
       WHERE quotation_id=$1`,
      [quotationId],
    );
    await recordQuotationEvent(client, result.rows[0], "cancelled", {
      actorUserId: access.context.userId,
      comment,
    });
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Quotation cancelled",
      quotation: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to cancel quotation", error);
    return NextResponse.json(
      { error: "Unable to cancel quotation" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
