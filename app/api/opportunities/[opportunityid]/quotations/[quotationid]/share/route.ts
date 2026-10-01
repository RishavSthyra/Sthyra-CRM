import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOpportunity } from "@/lib/opportunityAccess";
import { parseUuid } from "@/lib/operations";
import {
  issueQuotationShareLink,
  quotationShareUrl,
  recordQuotationEvent,
} from "@/lib/quotations";
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
  const input = isObject(body) && !Array.isArray(body) ? body : {};
  const recipientEmail =
    typeof input.recipient_email === "string"
      ? input.recipient_email.trim().toLowerCase()
      : null;
  if (recipientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail))
    return NextResponse.json(
      { error: "recipient_email must be a valid email address" },
      { status: 422 },
    );
  const validityDays =
    Number.isSafeInteger(input.validity_days) && Number(input.validity_days) > 0
      ? Number(input.validity_days)
      : 30;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM opportunity_quotations
       WHERE quotation_id=$1 AND opportunity_id=$2 FOR UPDATE`,
      [quotationId, access.opportunityId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Quotation not found" },
        { status: 404 },
      );
    }
    let quotation = result.rows[0];
    if (["rejected", "expired", "cancelled"].includes(quotation.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `A ${quotation.status} quotation cannot be shared` },
        { status: 409 },
      );
    }
    if (quotation.valid_until && new Date(quotation.valid_until) < new Date()) {
      quotation = (
        await client.query(
          `UPDATE opportunity_quotations
           SET status='expired',expired_at=CURRENT_TIMESTAMP,
               updated_by=$2,updated_at=CURRENT_TIMESTAMP
           WHERE quotation_id=$1 RETURNING *`,
          [quotationId, access.context.userId],
        )
      ).rows[0];
      await recordQuotationEvent(client, quotation, "expired", {
        actorUserId: access.context.userId,
        comment: "Quotation validity date has passed",
      });
      await client.query("COMMIT");
      return NextResponse.json(
        { error: "This quotation has expired. Create a revision to share it." },
        { status: 409 },
      );
    }
    if (quotation.status === "draft") {
      quotation = (
        await client.query(
          `UPDATE opportunity_quotations
           SET status='sent',sent_at=COALESCE(sent_at,CURRENT_TIMESTAMP),
               sent_by=$2,updated_by=$2,updated_at=CURRENT_TIMESTAMP
           WHERE quotation_id=$1 RETURNING *`,
          [quotationId, access.context.userId],
        )
      ).rows[0];
    }
    const share = await issueQuotationShareLink(client, quotation, {
      createdBy: access.context.userId,
      recipientEmail,
      validityDays,
    });
    await recordQuotationEvent(client, quotation, "shared", {
      actorUserId: access.context.userId,
      metadata: {
        share_link_id: share.share_link_id,
        recipient_email: recipientEmail,
        expires_at: share.expires_at,
      },
    });
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Secure quotation link created",
      share_url: quotationShareUrl(share.token, request.nextUrl.origin),
      expires_at: share.expires_at,
      quotation,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to create quotation share link", error);
    return NextResponse.json(
      { error: "Unable to create quotation link" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
