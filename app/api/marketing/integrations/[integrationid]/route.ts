import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/authorization";
import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";

type Context = { params: Promise<{ integrationid: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requirePermission(request, "WORKSPACE_MANAGE");
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects) return NextResponse.json({ error: "Company administrator access is required" }, { status: 403 });
  const id = (await context.params).integrationid;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid integration ID" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!isObject(body) || Array.isArray(body)) return NextResponse.json({ error: "Request body must be an object" }, { status: 422 });
  const values: unknown[] = [];
  const changes: string[] = [];
  const add = (field: string, value: unknown, cast = "") => { values.push(value); changes.push(`${field}=$${values.length}${cast}`); };
  if (body.integration_name !== undefined) {
    if (typeof body.integration_name !== "string" || !body.integration_name.trim()) return NextResponse.json({ error: "integration_name is required" }, { status: 422 });
    add("integration_name", body.integration_name.trim().slice(0, 160));
  }
  for (const field of ["external_account_id", "login_account_id"] as const) {
    if (body[field] !== undefined) add(field, typeof body[field] === "string" ? body[field].replace(/\D/g, "") || null : null);
  }
  if (body.settings !== undefined) {
    if (!isObject(body.settings) || Array.isArray(body.settings)) return NextResponse.json({ error: "settings must be an object" }, { status: 422 });
    add("settings", JSON.stringify(body.settings), "::jsonb");
  }
  if (body.status !== undefined) {
    if (!['draft', 'connected', 'error', 'disabled'].includes(String(body.status))) return NextResponse.json({ error: "Invalid status" }, { status: 422 });
    add("status", body.status);
  }
  if (!changes.length) return NextResponse.json({ error: "No changes supplied" }, { status: 422 });
  values.push(scope.context.userId, scope.context.access.company.company_id, id);
  try {
    const result = await pool.query(
      `UPDATE marketing_integrations SET ${changes.join(", ")},
              updated_by=$${values.length - 2}, updated_at=CURRENT_TIMESTAMP
       WHERE company_id=$${values.length - 1} AND integration_id=$${values.length}
       RETURNING integration_id, provider, integration_name, status,
                 external_account_id, login_account_id, scopes, settings,
                 access_token_expires_at, last_synced_at, last_error,
                 created_at, updated_at`,
      values,
    );
    if (!result.rowCount) return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    return NextResponse.json({ integration: result.rows[0] });
  } catch (error) {
    console.error("Unable to update marketing integration", error);
    return NextResponse.json({ error: "Unable to update marketing integration" }, { status: 500 });
  }
}
