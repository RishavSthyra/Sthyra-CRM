import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAuditLogAccess } from "@/lib/authorization";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const scope = await requireAuditLogAccess(request);
  if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  if (pagination.limit > 100) {
    return NextResponse.json({ error: "limit cannot exceed 100" }, { status: 400 });
  }

  const filters = ["audit.company_id = $1"];
  const values: unknown[] = [scope.context.access.company.company_id];
  const entityType = request.nextUrl.searchParams.get("entity_type")?.trim();
  if (entityType) {
    if (!/^[a-z0-9_]{1,100}$/i.test(entityType)) {
      return NextResponse.json({ error: "Invalid entity_type" }, { status: 400 });
    }
    values.push(entityType);
    filters.push(`audit.entity_type = $${values.length}`);
  }
  const action = request.nextUrl.searchParams.get("action")?.trim().toUpperCase();
  if (action) {
    if (!["INSERT", "UPDATE", "DELETE"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    values.push(action);
    filters.push(`audit.action = $${values.length}`);
  }
  const where = `WHERE ${filters.join(" AND ")}`;

  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM audit_logs audit ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT audit.audit_id, audit.action, audit.entity_type, audit.entity_id,
              audit.changed_fields, audit.old_values, audit.new_values,
              audit.created_at, audit.actor_user_id,
              COALESCE(NULLIF(BTRIM(CONCAT(actor.first_name, ' ', actor.last_name)), ''), actor.email) AS actor_name,
              COALESCE(
                NULLIF(BTRIM(CONCAT_WS(' ', snapshot.data->>'first_name', snapshot.data->>'last_name')), ''),
                NULLIF(snapshot.data->>'company_name', ''),
                NULLIF(snapshot.data->>'project_name', ''),
                NULLIF(snapshot.data->>'opportunity_name', ''),
                NULLIF(snapshot.data->>'booking_reference', ''),
                NULLIF(snapshot.data->>'queue_name', ''),
                NULLIF(snapshot.data->>'rule_name', ''),
                NULLIF(snapshot.data->>'sla_name', ''),
                NULLIF(snapshot.data->>'campaign_name', ''),
                NULLIF(snapshot.data->>'source_name', ''),
                NULLIF(snapshot.data->>'tag_name', ''),
                NULLIF(snapshot.data->>'role_name', ''),
                NULLIF(snapshot.data->>'name', ''),
                NULLIF(snapshot.data->>'subject', ''),
                NULLIF(snapshot.data->>'title', ''),
                NULLIF(snapshot.data->>'email', ''),
                NULLIF(BTRIM(CONCAT_WS(' ', related_contact.first_name, related_contact.last_name)), ''),
                related_contact.email,
                NULLIF(BTRIM(CONCAT_WS(' ', related_lead_contact.first_name, related_lead_contact.last_name)), ''),
                related_lead_contact.email,
                related_opportunity.opportunity_name
              ) AS record_label
       FROM audit_logs audit
       LEFT JOIN users actor ON actor.user_id = audit.actor_user_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(audit.new_values, audit.old_values, '{}'::jsonb) AS data
       ) snapshot ON TRUE
       LEFT JOIN contacts related_contact
         ON related_contact.contact_id = CASE
           WHEN snapshot.data ? 'contact_id'
           THEN NULLIF(snapshot.data->>'contact_id', '')::uuid
           ELSE NULL
         END
       LEFT JOIN leads related_lead
         ON related_lead.lead_id = CASE
           WHEN snapshot.data ? 'lead_id'
           THEN NULLIF(snapshot.data->>'lead_id', '')::uuid
           ELSE NULL
         END
       LEFT JOIN contacts related_lead_contact
         ON related_lead_contact.contact_id = related_lead.contact_id
       LEFT JOIN opportunities related_opportunity
         ON related_opportunity.opportunity_id = CASE
           WHEN snapshot.data ? 'opportunity_id'
           THEN NULLIF(snapshot.data->>'opportunity_id', '')::uuid
           ELSE NULL
         END
       ${where}
       ORDER BY audit.created_at DESC, audit.audit_id DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    const response = NextResponse.json({
      logs: result.rows,
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
    console.error("Failed to retrieve audit log", error);
    return NextResponse.json({ error: "Unable to retrieve audit log" }, { status: 500 });
  }
}
