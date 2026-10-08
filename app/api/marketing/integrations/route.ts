import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/authorization";
import { isObject } from "@/utils/isObject";

export async function GET(request: NextRequest) {
  const scope = await requirePermission(request, "WORKSPACE_MANAGE");
  if (!scope.ok) return scope.response;
  try {
    const result = await pool.query(
      `SELECT integration_id, provider, integration_name, status,
              external_account_id, login_account_id, scopes, settings,
              access_token_expires_at, last_synced_at, last_error,
              created_at, updated_at,
              (refresh_token_ciphertext IS NOT NULL) AS has_refresh_token
       FROM marketing_integrations
       WHERE company_id=$1
       ORDER BY created_at DESC`,
      [scope.context.access.company.company_id],
    );
    return NextResponse.json({ integrations: result.rows });
  } catch (error) {
    console.error("Unable to list marketing integrations", error);
    return NextResponse.json({ error: "Unable to retrieve integrations" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const scope = await requirePermission(request, "WORKSPACE_MANAGE");
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects) return NextResponse.json({ error: "Company administrator access is required" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!isObject(body) || Array.isArray(body)) return NextResponse.json({ error: "Request body must be an object" }, { status: 422 });
  const provider = body.provider === "google_data_manager" ? body.provider : null;
  const name = typeof body.integration_name === "string" ? body.integration_name.trim() : "";
  const accountId = typeof body.external_account_id === "string" ? body.external_account_id.replace(/\D/g, "") : "";
  const loginAccountId = typeof body.login_account_id === "string" ? body.login_account_id.replace(/\D/g, "") : "";
  const settings = isObject(body.settings) && !Array.isArray(body.settings) ? body.settings : {};
  if (!provider || !name || !accountId) return NextResponse.json({ error: "Google Ads account ID and integration name are required" }, { status: 422 });
  try {
    const result = await pool.query(
      `INSERT INTO marketing_integrations (
         company_id, provider, integration_name, external_account_id,
         login_account_id, settings, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$7)
       RETURNING integration_id, provider, integration_name, status,
                 external_account_id, login_account_id, settings, created_at`,
      [scope.context.access.company.company_id, provider, name.slice(0, 160), accountId, loginAccountId || accountId, JSON.stringify(settings), scope.context.userId],
    );
    return NextResponse.json({ integration: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("Unable to create marketing integration", error);
    return NextResponse.json({ error: "Unable to create marketing integration" }, { status: 500 });
  }
}
