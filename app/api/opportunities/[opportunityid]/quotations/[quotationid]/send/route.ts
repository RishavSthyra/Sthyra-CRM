import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { processEmailDeliveryJob } from "@/lib/email/deliveryJobs";
import { requireOpportunity } from "@/lib/opportunityAccess";
import { parseUuid } from "@/lib/operations";
import { generateQuotationPdf } from "@/lib/quotationPdf";
import {
  escapeHtml,
  getQuotationDetail,
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
  const connectionId =
    typeof body.email_connection_id === "string"
      ? parseUuid(body.email_connection_id)
      : null;
  const toAddress =
    typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
  if (!connectionId)
    return NextResponse.json(
      { error: "Select a connected mailbox" },
      { status: 422 },
    );
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toAddress))
    return NextResponse.json(
      { error: "Enter a valid recipient email address" },
      { status: 422 },
    );
  const validityDays =
    Number.isSafeInteger(body.validity_days) && Number(body.validity_days) > 0
      ? Number(body.validity_days)
      : 30;

  const client = await pool.connect();
  let jobId: string | null = null;
  let emailId: string | null = null;
  let shareLinkId: string | null = null;
  let shareUrl = "";
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
    if (["rejected", "expired", "cancelled"].includes(quotation.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `A ${quotation.status} quotation cannot be sent` },
        { status: 409 },
      );
    }
    if (quotation.valid_until && new Date(quotation.valid_until) < new Date()) {
      await client.query(
        `UPDATE opportunity_quotations
         SET status='expired',expired_at=CURRENT_TIMESTAMP,
             updated_by=$2,updated_at=CURRENT_TIMESTAMP
         WHERE quotation_id=$1`,
        [quotationId, access.context.userId],
      );
      await recordQuotationEvent(client, quotation, "expired", {
        actorUserId: access.context.userId,
        comment: "Quotation validity date has passed",
      });
      await client.query("COMMIT");
      return NextResponse.json(
        { error: "This quotation has expired. Create a revision to send it." },
        { status: 409 },
      );
    }
    const mailbox = await client.query(
      `SELECT email_connection_id,email_address,provider
       FROM email_connections
       WHERE email_connection_id=$1 AND company_id=$2 AND user_id=$3
         AND status='connected'`,
      [
        connectionId,
        access.context.access.company.company_id,
        access.context.userId,
      ],
    );
    if (!mailbox.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Select a connected mailbox or reconnect it in Settings" },
        { status: 422 },
      );
    }
    const detail = await getQuotationDetail(
      client,
      quotationId,
      access.opportunityId,
    );
    if (!detail)
      throw new Error("Quotation detail disappeared during delivery");
    const share = await issueQuotationShareLink(client, quotation, {
      createdBy: access.context.userId,
      recipientEmail: toAddress,
      validityDays,
    });
    shareLinkId = String(share.share_link_id);
    shareUrl = quotationShareUrl(share.token, request.nextUrl.origin);
    const pdf = await generateQuotationPdf(detail);
    const customerName =
      `${String(detail.first_name || "")} ${String(detail.last_name || "")}`.trim();
    const subject =
      typeof body.subject === "string" && body.subject.trim()
        ? body.subject.trim().slice(0, 250)
        : `${String(detail.quotation_number)} — ${String(detail.project_name)}`;
    const personalMessage =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim().slice(0, 10000)
        : String(
            detail.customer_message || "Please review the attached quotation.",
          );
    const html = `
      <div style="font-family:Arial,sans-serif;color:#17201d;line-height:1.6;max-width:640px;margin:auto">
        <p>Hello ${escapeHtml(customerName || "there")},</p>
        <p>${escapeHtml(personalMessage).replaceAll("\n", "<br>")}</p>
        <p><strong>${escapeHtml(detail.title)}</strong><br>
          ${escapeHtml(detail.quotation_number)} · Version ${escapeHtml(detail.version)} ·
          ${escapeHtml(detail.currency)} ${Number(detail.total_amount || 0).toLocaleString("en-IN")}
        </p>
        <p style="margin:28px 0">
          <a href="${escapeHtml(shareUrl)}" style="background:#287b63;color:white;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block">Review quotation</a>
        </p>
        <p style="font-size:12px;color:#68716d">This secure link expires on ${escapeHtml(new Date(share.expires_at).toLocaleString("en-IN"))}. A PDF copy is attached.</p>
        <p>Regards,<br>${escapeHtml(detail.company_name)}</p>
      </div>`;
    const emailResult = await client.query(
      `INSERT INTO emails (
         company_id,project_id,lead_id,contact_id,direction,status,subject,body,
         from_address,to_addresses,cc_addresses,owner_user_id,created_by,
         email_connection_id,provider,queued_at
       ) VALUES ($1,$2,$3,$4,'outbound','queued',$5,$6,$7,$8,$9,$10,$10,$11,$12,CURRENT_TIMESTAMP)
       RETURNING email_id`,
      [
        detail.company_id,
        detail.project_id,
        detail.lead_id,
        detail.contact_id,
        subject,
        html,
        mailbox.rows[0].email_address,
        [toAddress],
        [],
        access.context.userId,
        connectionId,
        mailbox.rows[0].provider,
      ],
    );
    emailId = String(emailResult.rows[0].email_id);
    await client.query(
      `INSERT INTO email_attachments (
         email_id,company_id,project_id,file_name,mime_type,size_bytes,
         content,uploaded_by
       ) VALUES ($1,$2,$3,$4,'application/pdf',$5,$6,$7)`,
      [
        emailId,
        detail.company_id,
        detail.project_id,
        `${String(detail.quotation_number)}-V${String(detail.version)}.pdf`,
        pdf.byteLength,
        pdf,
        access.context.userId,
      ],
    );
    const job = await client.query(
      `INSERT INTO email_delivery_jobs (email_id,company_id)
       VALUES ($1,$2) RETURNING email_delivery_job_id`,
      [emailId, detail.company_id],
    );
    jobId = String(job.rows[0].email_delivery_job_id);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to queue quotation email", error);
    return NextResponse.json(
      { error: "Unable to prepare quotation email" },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  const delivery = jobId ? await processEmailDeliveryJob(jobId) : null;
  if (!delivery?.sent) {
    if (shareLinkId) {
      await pool
        .query(
          `UPDATE quotation_share_links
           SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP)
           WHERE share_link_id=$1`,
          [shareLinkId],
        )
        .catch((error) =>
          console.error("Failed to revoke undelivered quotation link", error),
        );
    }
    return NextResponse.json(
      {
        error: delivery?.error || "Quotation email could not be delivered",
        email_id: emailId,
      },
      { status: 502 },
    );
  }

  const eventClient = await pool.connect();
  try {
    await eventClient.query("BEGIN");
    const updated = await eventClient.query(
      `UPDATE opportunity_quotations
       SET status=CASE WHEN status='draft' THEN 'sent' ELSE status END,
           sent_at=COALESCE(sent_at,CURRENT_TIMESTAMP),sent_by=$2,
           updated_by=$2,updated_at=CURRENT_TIMESTAMP
       WHERE quotation_id=$1 RETURNING *`,
      [quotationId, access.context.userId],
    );
    await recordQuotationEvent(eventClient, updated.rows[0], "sent", {
      actorUserId: access.context.userId,
      metadata: { recipient_email: toAddress, email_id: emailId },
    });
    await eventClient.query("COMMIT");
    return NextResponse.json({
      message: "Quotation sent",
      quotation: updated.rows[0],
      share_url: shareUrl,
      email_id: emailId,
    });
  } catch (error) {
    await eventClient.query("ROLLBACK").catch(() => undefined);
    console.error("Quotation delivered but status update failed", error);
    return NextResponse.json({
      message: "Quotation email sent; refresh to update its status",
      share_url: shareUrl,
      email_id: emailId,
    });
  } finally {
    eventClient.release();
  }
}
