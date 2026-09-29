import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { createMarketingSecret, hashMarketingSecret } from "@/lib/marketing";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";

type Context = { params: Promise<{ formid: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects) {
    return NextResponse.json({ error: "Company administrator access is required" }, { status: 403 });
  }
  const formId = (await context.params).formid;
  if (!isUuid(formId)) return NextResponse.json({ error: "Invalid form ID" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!isObject(body) || Array.isArray(body)) return NextResponse.json({ error: "Request body must be an object" }, { status: 422 });
  const allowed = new Set(["form_name", "source_id", "campaign_id", "provider_form_id", "allowed_origins", "field_mapping", "lead_defaults", "consent_notice", "is_active", "rotate_submission_secret", "rotate_webhook_secret"]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) return NextResponse.json({ error: `Unknown fields: ${unknown.join(", ")}` }, { status: 422 });
  const values: unknown[] = [];
  const changes: string[] = [];
  const add = (column: string, value: unknown, cast = "") => { values.push(value); changes.push(`${column}=$${values.length}${cast}`); };
  if (body.form_name !== undefined) {
    if (typeof body.form_name !== "string" || !body.form_name.trim() || body.form_name.trim().length > 180) return NextResponse.json({ error: "Invalid form name" }, { status: 422 });
    add("form_name", body.form_name.trim());
  }
  for (const field of ["source_id", "campaign_id"] as const) {
    if (body[field] !== undefined) {
      if (body[field] !== null && !isUuid(body[field])) return NextResponse.json({ error: `${field} must be a UUID or null` }, { status: 422 });
      add(field, body[field]);
    }
  }
  if (body.provider_form_id !== undefined) add("provider_form_id", typeof body.provider_form_id === "string" ? body.provider_form_id.trim().slice(0, 200) || null : null);
  if (body.allowed_origins !== undefined) {
    if (!Array.isArray(body.allowed_origins)) return NextResponse.json({ error: "allowed_origins must be an array" }, { status: 422 });
    add("allowed_origins", [...new Set(body.allowed_origins.map((item) => String(item).trim()).filter(Boolean))]);
  }
  if (body.field_mapping !== undefined) {
    if (!isObject(body.field_mapping) || Array.isArray(body.field_mapping)) return NextResponse.json({ error: "field_mapping must be an object" }, { status: 422 });
    add("field_mapping", JSON.stringify(body.field_mapping), "::jsonb");
  }
  if (body.lead_defaults !== undefined) {
    if (!isObject(body.lead_defaults) || Array.isArray(body.lead_defaults)) return NextResponse.json({ error: "lead_defaults must be an object" }, { status: 422 });
    add("lead_defaults", JSON.stringify(body.lead_defaults), "::jsonb");
  }
  if (body.consent_notice !== undefined) add("consent_notice", typeof body.consent_notice === "string" ? body.consent_notice.trim().slice(0, 5000) || null : null);
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") return NextResponse.json({ error: "is_active must be boolean" }, { status: 422 });
    add("is_active", body.is_active);
  }
  let submissionSecret: string | null = null;
  let webhookSecret: string | null = null;
  if (body.rotate_submission_secret === true) {
    submissionSecret = createMarketingSecret();
    add("submission_secret_hash", hashMarketingSecret(submissionSecret));
  }
  if (body.rotate_webhook_secret === true) {
    webhookSecret = createMarketingSecret();
    add("webhook_secret_hash", hashMarketingSecret(webhookSecret));
  }
  if (!changes.length) return NextResponse.json({ error: "No changes supplied" }, { status: 422 });
  values.push(scope.context.userId, scope.context.access.company.company_id, formId);
  try {
    const result = await pool.query(
      `UPDATE marketing_forms SET ${changes.join(", ")}, updated_by=$${values.length - 2}, updated_at=CURRENT_TIMESTAMP
       WHERE company_id=$${values.length - 1} AND form_id=$${values.length}
       RETURNING form_id, project_id, integration_id, source_id, campaign_id,
                 form_name, provider, public_key::text, provider_form_id,
                 allowed_origins, field_mapping, lead_defaults, consent_notice,
                 is_active, created_at, updated_at`,
      values,
    );
    if (!result.rowCount) return NextResponse.json({ error: "Form not found" }, { status: 404 });
    return NextResponse.json({
      form: result.rows[0],
      ...(submissionSecret || webhookSecret ? {
        credentials: { submission_secret: submissionSecret, google_key: webhookSecret },
        warning: "Copy the rotated credentials now. They cannot be shown again.",
      } : {}),
    });
  } catch (error) {
    console.error("Unable to update marketing form", error);
    return NextResponse.json({ error: "Unable to update marketing form" }, { status: 500 });
  }
}

