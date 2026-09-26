import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { parseUuid } from "@/lib/operations";
import { getAccessibleProjectIds } from "@/lib/projectAccess";
import {
  addTransferHistory,
  copyTransferChecklist,
  getTransferSubject,
  TRANSFER_COLUMNS,
  validateTransferPayload,
  validateTransferReferences,
} from "@/lib/transfers";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";
import { parsePagination } from "@/utils/parsePagination";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok)
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  const projectIds = getAccessibleProjectIds(scope.context.access);
  const values: unknown[] = [scope.context.access.company.company_id, projectIds];
  const filters = ["tr.company_id=$1", "tr.project_id=ANY($2::integer[])"];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue) {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId || !projectIds.includes(projectId))
      return NextResponse.json({ error: "Invalid or inaccessible project_id" }, { status: 400 });
    values.push(projectId);
    filters.push(`tr.project_id=$${values.length}`);
  }
  const status = request.nextUrl.searchParams.get("status");
  if (status) {
    const statuses = ["draft", "validated", "submitted", "accepted", "rejected", "cancelled", "expired", "force_assigned"];
    if (!statuses.includes(status))
      return NextResponse.json({ error: "Invalid transfer status" }, { status: 400 });
    values.push(status);
    filters.push(`tr.status=$${values.length}`);
  }
  const subjectType = request.nextUrl.searchParams.get("subject_type");
  if (subjectType) {
    if (!["lead", "opportunity"].includes(subjectType))
      return NextResponse.json({ error: "subject_type must be lead or opportunity" }, { status: 400 });
    values.push(subjectType);
    filters.push(`tr.subject_type=$${values.length}`);
  }
  for (const field of ["lead_id", "opportunity_id", "to_owner_user_id", "to_team_id", "requested_by"] as const) {
    const raw = request.nextUrl.searchParams.get(field);
    if (!raw) continue;
    const id = parseUuid(raw);
    if (!id)
      return NextResponse.json({ error: `${field} must be a valid UUID` }, { status: 400 });
    values.push(id);
    filters.push(`tr.${field}=$${values.length}`);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(`SELECT COUNT(*)::integer AS total FROM transfers tr ${where}`, values);
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${TRANSFER_COLUMNS}, p.project_name,
        COALESCE(o.opportunity_name, BTRIM(CONCAT_WS(' ',c.first_name,c.last_name))) AS subject_name,
        recipient.first_name AS recipient_first_name,
        recipient.last_name AS recipient_last_name,
        recipient_team.name AS recipient_team_name,
        requester.first_name AS requester_first_name,
        requester.last_name AS requester_last_name
       FROM transfers tr
       JOIN projects p ON p.project_id=tr.project_id
       LEFT JOIN opportunities o ON o.opportunity_id=tr.opportunity_id
       LEFT JOIN leads l ON l.lead_id=tr.lead_id
       LEFT JOIN contacts c ON c.contact_id=COALESCE(o.contact_id,l.contact_id)
       LEFT JOIN users recipient ON recipient.user_id=tr.to_owner_user_id
       LEFT JOIN teams recipient_team ON recipient_team.team_id=tr.to_team_id
       LEFT JOIN users requester ON requester.user_id=tr.requested_by
       ${where}
       ORDER BY tr.created_at DESC, tr.transfer_id DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      transfers: result.rows,
      pagination: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) },
    });
  } catch (error) {
    console.error("Failed to list transfers", error);
    return NextResponse.json({ error: "Unable to retrieve transfers" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 });
  }
  const validation = validateTransferPayload(body, false);
  if (!validation.ok)
    return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const subject = await getTransferSubject(client, validation.data, true);
    if (!subject) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Transfer subject not found" }, { status: 404 });
    }
    if (!canAccessOperationsEntity(scope.context.access, Number(subject.company_id), Number(subject.project_id))) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "You do not have access to this record" }, { status: 403 });
    }
    if (!scope.context.access.canViewAllProjects) {
      const teamMembership = subject.current_team_id
        ? await client.query(
            "SELECT 1 FROM users WHERE user_id=$1 AND team_id=$2 AND is_active=TRUE AND deleted_at IS NULL",
            [scope.context.userId, subject.current_team_id],
          )
        : null;
      const canRequest =
        !subject.current_owner_user_id &&
        !subject.current_team_id
          ? true
          : subject.current_owner_user_id === scope.context.userId ||
            Boolean(teamMembership?.rowCount);
      if (!canRequest) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Only the current owner, owning team, or an administrator can request a transfer" },
          { status: 403 },
        );
      }
    }
    if (subject.subject_type === "lead" && ["closed", "duplicate", "invalid"].includes(String(subject.status))) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: `A ${String(subject.status)} lead cannot be transferred` }, { status: 409 });
    }
    if (subject.subject_type === "opportunity" && subject.status === "closed") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "A closed opportunity cannot be transferred" }, { status: 409 });
    }
    if (
      subject.current_owner_user_id === validation.data.to_owner_user_id &&
      subject.current_team_id === validation.data.to_team_id
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "The selected recipient already owns this record" }, { status: 409 });
    }
    let templateId = validation.data.checklist_template_id ?? null;
    if (!templateId) {
      const template = await client.query(
        `SELECT template_id FROM transfer_checklist_templates
         WHERE company_id=$1 AND is_active=TRUE
           AND (project_id=$2 OR project_id IS NULL)
           AND applies_to IN ($3,'both')
         ORDER BY (project_id IS NOT NULL) DESC, updated_at DESC LIMIT 1`,
        [subject.company_id, subject.project_id, subject.subject_type],
      );
      templateId = template.rows[0]?.template_id ?? null;
    }
    const referenceErrors = await validateTransferReferences(
      client,
      Number(subject.company_id),
      Number(subject.project_id),
      { ...validation.data, checklist_template_id: templateId },
    );
    if (referenceErrors.length) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Validation failed", details: referenceErrors }, { status: 422 });
    }
    const inserted = await client.query(
      `INSERT INTO transfers (
         company_id, project_id, subject_type, lead_id, opportunity_id,
         from_owner_user_id, from_team_id, to_owner_user_id, to_team_id,
         checklist_template_id, reason, notes, expires_at, requested_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        subject.company_id,
        subject.project_id,
        subject.subject_type,
        subject.subject_type === "lead" ? subject.subject_id : null,
        subject.subject_type === "opportunity" ? subject.subject_id : null,
        subject.current_owner_user_id,
        subject.current_team_id,
        validation.data.to_owner_user_id ?? null,
        validation.data.to_team_id ?? null,
        templateId,
        validation.data.reason ?? null,
        validation.data.notes ?? null,
        validation.data.expires_at ?? null,
        scope.context.userId,
      ],
    );
    const transfer = inserted.rows[0];
    await copyTransferChecklist(client, transfer.transfer_id, templateId);
    await addTransferHistory(client, transfer, "created", "draft", scope.context.userId);
    await client.query("COMMIT");
    return NextResponse.json({ message: "Transfer created", transfer }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (getDatabaseErrorCode(error) === "23505")
      return NextResponse.json({ error: "This record already has an active transfer" }, { status: 409 });
    console.error("Failed to create transfer", error);
    return NextResponse.json({ error: "Unable to create transfer" }, { status: 500 });
  } finally {
    client.release();
  }
}
