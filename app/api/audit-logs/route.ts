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
              COALESCE(NULLIF(BTRIM(CONCAT(actor.first_name, ' ', actor.last_name)), ''), actor.email) AS actor_name
       FROM audit_logs audit
       LEFT JOIN users actor ON actor.user_id = audit.actor_user_id
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
