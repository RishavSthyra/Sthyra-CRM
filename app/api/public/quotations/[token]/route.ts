import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { adminPool } from "@/lib/db";
import { hashToken } from "@/lib/auth";
import {
  createNotificationsForUsers,
  resolveNotificationRecipients,
} from "@/lib/notifications";
import {
  getQuotationDetail,
  recordQuotationEvent,
  safePublicQuotation,
} from "@/lib/quotations";
import { enforceRateLimits } from "@/lib/rateLimit";
import { isObject } from "@/utils/isObject";

type Context = { params: Promise<{ token: string }> };

async function resolveLinkForUpdate(client: PoolClient, token: string) {
  return client.query(
    `SELECT link.*,quotation.opportunity_id,quotation.status AS quotation_status,
            quotation.valid_until
     FROM quotation_share_links link
     JOIN opportunity_quotations quotation ON quotation.quotation_id=link.quotation_id
     WHERE link.token_hash=$1
     FOR UPDATE OF link,quotation`,
    [hashToken(token)],
  );
}

export async function GET(request: NextRequest, context: Context) {
  const token = (await context.params).token.trim();
  if (!token || token.length > 200)
    return NextResponse.json(
      { error: "Invalid quotation link" },
      { status: 400 },
    );
  const rateLimit = await enforceRateLimits(request, [
    { action: "quotation-view:ip", limit: 120, windowSeconds: 10 * 60 },
    {
      action: "quotation-view:token",
      subject: `quotation:${token}`,
      limit: 60,
      windowSeconds: 10 * 60,
    },
  ]);
  if (rateLimit) return rateLimit;
  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    const result = await resolveLinkForUpdate(client, token);
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This quotation link is invalid" },
        { status: 404 },
      );
    }
    const link = result.rows[0];
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      String(link.opportunity_id),
    ]);
    if (link.revoked_at || new Date(link.expires_at) <= new Date()) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This quotation link has expired" },
        { status: 410 },
      );
    }
    if (
      link.valid_until &&
      new Date(`${String(link.valid_until).slice(0, 10)}T23:59:59Z`) <
        new Date() &&
      !["accepted", "rejected", "cancelled", "expired"].includes(
        link.quotation_status,
      )
    ) {
      const expired = await client.query(
        `UPDATE opportunity_quotations
         SET status='expired',expired_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
         WHERE quotation_id=$1 RETURNING *`,
        [link.quotation_id],
      );
      await client.query(
        "UPDATE quotation_share_links SET revoked_at=CURRENT_TIMESTAMP WHERE quotation_id=$1 AND revoked_at IS NULL",
        [link.quotation_id],
      );
      await recordQuotationEvent(client, expired.rows[0], "expired", {
        comment: "Quotation validity date has passed",
      });
      await client.query("COMMIT");
      return NextResponse.json(
        { error: "This quotation has expired" },
        { status: 410 },
      );
    }
    await client.query(
      `UPDATE quotation_share_links
       SET last_viewed_at=CURRENT_TIMESTAMP,view_count=view_count+1
       WHERE share_link_id=$1`,
      [link.share_link_id],
    );
    const updated = await client.query(
      `UPDATE opportunity_quotations
       SET status=CASE WHEN status='sent' THEN 'viewed' ELSE status END,
           viewed_at=COALESCE(viewed_at,CURRENT_TIMESTAMP),view_count=view_count+1,
           updated_at=CURRENT_TIMESTAMP
       WHERE quotation_id=$1 RETURNING *`,
      [link.quotation_id],
    );
    await recordQuotationEvent(client, updated.rows[0], "viewed", {
      actorEmail: link.recipient_email,
      metadata: { share_link_id: link.share_link_id },
    });
    const quotation = await getQuotationDetail(client, link.quotation_id);
    await client.query("COMMIT");
    const response = NextResponse.json({
      quotation: safePublicQuotation(quotation ?? updated.rows[0]),
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to retrieve public quotation", error);
    return NextResponse.json(
      { error: "Unable to retrieve quotation" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const token = (await context.params).token.trim();
  if (!token || token.length > 200)
    return NextResponse.json(
      { error: "Invalid quotation link" },
      { status: 400 },
    );
  const rateLimit = await enforceRateLimits(request, [
    { action: "quotation-response:ip", limit: 20, windowSeconds: 10 * 60 },
    {
      action: "quotation-response:token",
      subject: `quotation:${token}`,
      limit: 8,
      windowSeconds: 10 * 60,
    },
  ]);
  if (rateLimit) return rateLimit;
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
  const action = body.action;
  if (action !== "accept" && action !== "reject")
    return NextResponse.json(
      { error: "action must be accept or reject" },
      { status: 422 },
    );
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const comment =
    typeof body.comment === "string" ? body.comment.trim().slice(0, 10000) : "";
  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 250) : "";
  const errors: string[] = [];
  if (!name || name.length > 250) errors.push("Enter your full name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.push("Enter a valid email address");
  if (action === "reject" && !reason)
    errors.push("Select or enter a rejection reason");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );

  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    const result = await resolveLinkForUpdate(client, token);
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This quotation link is invalid" },
        { status: 404 },
      );
    }
    const link = result.rows[0];
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      String(link.opportunity_id),
    ]);
    if (link.revoked_at || new Date(link.expires_at) <= new Date()) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This quotation link has expired" },
        { status: 410 },
      );
    }
    if (!["sent", "viewed"].includes(link.quotation_status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            link.quotation_status === "accepted"
              ? "This quotation has already been accepted"
              : `This quotation is ${link.quotation_status} and can no longer be changed`,
        },
        { status: 409 },
      );
    }
    if (
      link.valid_until &&
      new Date(`${String(link.valid_until).slice(0, 10)}T23:59:59Z`) <
        new Date()
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This quotation has expired" },
        { status: 410 },
      );
    }

    let quotation: Record<string, unknown>;
    if (action === "accept") {
      const conflicts = await client.query(
        `SELECT quotation_id FROM opportunity_quotations
         WHERE opportunity_id=$1 AND status='accepted' AND quotation_id<>$2
         FOR UPDATE`,
        [link.opportunity_id, link.quotation_id],
      );
      if (conflicts.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            error: "Another quotation for this opportunity is already accepted",
          },
          { status: 409 },
        );
      }
      quotation = (
        await client.query(
          `UPDATE opportunity_quotations
           SET status='accepted',accepted_at=CURRENT_TIMESTAMP,
               accepted_by_name=$2,accepted_by_email=$3,acceptance_comment=$4,
               updated_at=CURRENT_TIMESTAMP
           WHERE quotation_id=$1 RETURNING *`,
          [link.quotation_id, name, email, comment || null],
        )
      ).rows[0];
      const expired = await client.query(
        `UPDATE opportunity_quotations
         SET status='expired',expired_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
         WHERE opportunity_id=$1 AND quotation_id<>$2
           AND status IN ('draft','sent','viewed')
         RETURNING *`,
        [link.opportunity_id, link.quotation_id],
      );
      for (const previous of expired.rows)
        await recordQuotationEvent(client, previous, "expired", {
          comment: "Another quotation was accepted",
        });
      await client.query(
        `UPDATE quotation_share_links share
         SET revoked_at=CURRENT_TIMESTAMP
         FROM opportunity_quotations quotation
         WHERE share.quotation_id=quotation.quotation_id
           AND quotation.opportunity_id=$1 AND quotation.quotation_id<>$2
           AND share.revoked_at IS NULL`,
        [link.opportunity_id, link.quotation_id],
      );
      await recordQuotationEvent(client, quotation, "accepted", {
        actorName: name,
        actorEmail: email,
        comment: comment || null,
      });
    } else {
      quotation = (
        await client.query(
          `UPDATE opportunity_quotations
           SET status='rejected',rejected_at=CURRENT_TIMESTAMP,
               rejected_reason=$2,rejection_comment=$3,updated_at=CURRENT_TIMESTAMP
           WHERE quotation_id=$1 RETURNING *`,
          [link.quotation_id, reason, comment || null],
        )
      ).rows[0];
      await client.query(
        "UPDATE quotation_share_links SET revoked_at=CURRENT_TIMESTAMP WHERE quotation_id=$1 AND revoked_at IS NULL",
        [link.quotation_id],
      );
      await recordQuotationEvent(client, quotation, "rejected", {
        actorName: name,
        actorEmail: email,
        comment: comment || reason,
        metadata: { reason },
      });
    }
    const opportunity = await client.query(
      `SELECT opportunity_name,company_id,project_id,current_owner_user_id,current_team_id
       FROM opportunities WHERE opportunity_id=$1`,
      [link.opportunity_id],
    );
    if (opportunity.rowCount) {
      const record = opportunity.rows[0];
      const recipients = await resolveNotificationRecipients(client, {
        companyId: Number(record.company_id),
        userIds: [record.current_owner_user_id],
        teamIds: [record.current_team_id],
      });
      await createNotificationsForUsers(client, recipients, {
        companyId: Number(record.company_id),
        projectId: Number(record.project_id),
        type: `quotation.${action === "accept" ? "accepted" : "rejected"}`,
        category: "quotation",
        title:
          action === "accept" ? "Quotation accepted" : "Quotation rejected",
        body: `${String(quotation.quotation_number)} V${String(quotation.version)} was ${action === "accept" ? "accepted" : "rejected"} by ${name}.`,
        severity: action === "accept" ? "success" : "warning",
        entityType: "quotation",
        entityId: String(quotation.quotation_id),
        actionUrl: `/opportunities?opportunity_id=${String(link.opportunity_id)}`,
        eventKey: `quotation:${String(quotation.quotation_id)}:${action}`,
        metadata: {
          quotation_id: quotation.quotation_id,
          customer_email: email,
          reason: reason || null,
        },
        channels: ["in_app"],
      });
    }
    await client.query("COMMIT");
    return NextResponse.json({
      message:
        action === "accept"
          ? "Quotation accepted successfully"
          : "Your response has been recorded",
      status: quotation.status,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to record quotation response", error);
    return NextResponse.json(
      { error: "Unable to record your response" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
