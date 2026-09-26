import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseActivityUuid, recordActivity } from "@/lib/activities";
import { processEmailDeliveryJob } from "@/lib/email/deliveryJobs";
import {
  EMAIL_COLUMNS,
  resolveCommunicationContact,
  validateEmailAttachments,
  validateEmailPayload,
} from "@/lib/communications";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject, getAccessibleProjectIds } from "@/lib/projectAccess";
import { parsePagination } from "@/utils/parsePagination";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams, 30, 100);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  const values: unknown[] = [getAccessibleProjectIds(scope.context.access)];
  const filters = ["e.project_id=ANY($1::integer[])"];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue) {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId || !canAccessProject(scope.context.access, projectId)) {
      return NextResponse.json(
        { error: "Invalid or inaccessible project_id" },
        { status: 400 },
      );
    }
    values.push(projectId);
    filters.push(`e.project_id=$${values.length}`);
  }
  for (const field of ["lead_id", "contact_id", "owner_user_id"] as const) {
    const raw = request.nextUrl.searchParams.get(field);
    if (!raw) continue;
    const id = parseActivityUuid(raw);
    if (!id) {
      return NextResponse.json(
        { error: `${field} must be a valid UUID` },
        { status: 400 },
      );
    }
    values.push(id);
    filters.push(`e.${field}=$${values.length}`);
  }
  const direction = request.nextUrl.searchParams.get("direction");
  if (direction) {
    if (!['inbound', 'outbound'].includes(direction)) {
      return NextResponse.json({ error: "Invalid email direction" }, { status: 400 });
    }
    values.push(direction);
    filters.push(`e.direction=$${values.length}`);
  }
  const status = request.nextUrl.searchParams.get("status");
  if (status) {
    if (!['draft', 'scheduled', 'queued', 'sending', 'sent', 'delivered', 'opened', 'replied', 'bounced', 'failed', 'cancelled', 'received'].includes(status)) {
      return NextResponse.json({ error: "Invalid email status" }, { status: 400 });
    }
    values.push(status);
    filters.push(`e.status=$${values.length}`);
  }
  const search = request.nextUrl.searchParams.get("search")?.trim();
  if (search) {
    values.push(`%${search}%`);
    filters.push(
      `(e.subject ILIKE $${values.length} OR e.body ILIKE $${values.length} OR e.from_address ILIKE $${values.length})`,
    );
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM emails e ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${EMAIL_COLUMNS}, p.project_name,
        ct.first_name AS contact_first_name, ct.last_name AS contact_last_name,
        u.first_name AS owner_first_name, u.last_name AS owner_last_name,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'attachment_id', a.attachment_id,
            'file_name', a.file_name,
            'mime_type', a.mime_type,
            'size_bytes', a.size_bytes
          ) ORDER BY a.created_at, a.attachment_id)
          FROM email_attachments a WHERE a.email_id=e.email_id
        ), '[]'::jsonb) AS attachments
       FROM emails e
       JOIN projects p ON p.project_id=e.project_id
       LEFT JOIN contacts ct ON ct.contact_id=e.contact_id
       LEFT JOIN users u ON u.user_id=e.owner_user_id
       ${where}
       ORDER BY COALESCE(e.sent_at, e.received_at, e.created_at) DESC, e.email_id DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      emails: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list emails", error);
    return NextResponse.json({ error: "Unable to retrieve emails" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const validation = validateEmailPayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  const attachmentValidation = validateEmailAttachments(
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>).attachments
      : undefined,
  );
  if (!attachmentValidation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: attachmentValidation.errors },
      { status: 422 },
    );
  }
  if (!canAccessProject(scope.context.access, validation.data.project_id)) {
    return NextResponse.json(
      { error: "You do not have access to this project" },
      { status: 403 },
    );
  }
  const client = await pool.connect();
  let jobId: string | null = null;
  let emailId: string | null = null;
  let createdEmail: Record<string, unknown> | null = null;
  let createdAttachments: Array<{
    attachment_id: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
  }> = [];
  try {
    await client.query("BEGIN");
    const outbound = (validation.data.direction ?? "outbound") === "outbound";
    let sender = validation.data.from_address ?? "";
    let provider: string | null = null;
    if (outbound) {
      const connection = await client.query(
        `SELECT email_address, provider
         FROM email_connections
         WHERE email_connection_id=$1 AND company_id=$2 AND user_id=$3
           AND status='connected'`,
        [
          validation.data.email_connection_id,
          scope.context.access.company.company_id,
          scope.context.userId,
        ],
      );
      if (!connection.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Select a connected email account or reconnect it in Settings" },
          { status: 422 },
        );
      }
      sender = String(connection.rows[0].email_address);
      provider = String(connection.rows[0].provider);
    }
    const contactId = await resolveCommunicationContact(
      client,
      scope.context.access.company.company_id,
      validation.data.project_id,
      validation.data.lead_id,
      validation.data.contact_id,
    );
    const result = await client.query(
      `INSERT INTO emails (
         company_id, project_id, lead_id, contact_id, direction, status,
         subject, body, from_address, to_addresses, cc_addresses, sent_at,
         received_at, owner_user_id, created_by, email_connection_id,
         provider, queued_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16,$17)
       RETURNING *`,
      [
        scope.context.access.company.company_id,
        validation.data.project_id,
        validation.data.lead_id ?? null,
        contactId,
        validation.data.direction ?? "outbound",
        outbound ? "queued" : (validation.data.status ?? "received"),
        validation.data.subject,
        validation.data.body,
        sender,
        validation.data.to_addresses,
        validation.data.cc_addresses ?? [],
        outbound ? null : (validation.data.sent_at ?? null),
        validation.data.received_at ?? null,
        scope.context.userId,
        validation.data.email_connection_id ?? null,
        provider,
        outbound ? new Date() : null,
      ],
    );
    const email = result.rows[0];
    const attachments: Array<{
      attachment_id: string;
      file_name: string;
      mime_type: string;
      size_bytes: number;
    }> = [];
    for (const attachment of attachmentValidation.data) {
      const inserted = await client.query(
        `INSERT INTO email_attachments (
           email_id, company_id, project_id, file_name, mime_type,
           size_bytes, content, uploaded_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING attachment_id, file_name, mime_type, size_bytes`,
        [
          email.email_id,
          email.company_id,
          email.project_id,
          attachment.file_name,
          attachment.mime_type,
          attachment.size_bytes,
          attachment.content,
          scope.context.userId,
        ],
      );
      attachments.push(inserted.rows[0]);
    }
    if (outbound) {
      const job = await client.query(
        `INSERT INTO email_delivery_jobs (email_id, company_id)
         VALUES ($1,$2) RETURNING email_delivery_job_id`,
        [email.email_id, email.company_id],
      );
      jobId = String(job.rows[0].email_delivery_job_id);
    } else {
      await recordActivity(
        client,
        email,
        "email",
        "email_received",
        email.subject,
        scope.context.userId,
        {
          description: email.body,
          metadata: {
            direction: email.direction,
            status: email.status,
            from_address: email.from_address,
            to_addresses: email.to_addresses,
            attachment_count: attachments.length,
          },
          occurredAt: email.received_at ?? email.created_at,
        },
      );
    }
    await client.query("COMMIT");
    emailId = String(email.email_id);
    createdEmail = email;
    createdAttachments = attachments;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const message = error instanceof Error ? error.message : "Unable to record email";
    if (message.includes("lead_id") || message.includes("contact_id")) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    console.error("Failed to create email", error);
    return NextResponse.json({ error: "Unable to record email" }, { status: 500 });
  } finally {
    client.release();
  }

  if (jobId) {
    const delivery = await processEmailDeliveryJob(jobId);
    const latest = emailId
      ? await pool.query("SELECT * FROM emails WHERE email_id=$1", [emailId])
      : null;
    if (!delivery?.sent) {
      return NextResponse.json(
        {
          error: delivery?.error || "Email was queued but could not be delivered",
          email: latest?.rows[0] ?? createdEmail,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        message: "Email sent and recorded",
        delivery: { configured: true, sent: true },
        email: { ...(latest?.rows[0] ?? createdEmail), attachments: createdAttachments },
      },
      { status: 201 },
    );
  }
  return NextResponse.json(
    {
      message: "Email recorded",
      delivery: { configured: false, sent: false },
      email: { ...createdEmail, attachments: createdAttachments },
    },
    { status: 201 },
  );
}
