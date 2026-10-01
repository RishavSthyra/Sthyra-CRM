import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  createMarketingSecret,
  hashMarketingSecret,
} from "@/lib/marketing";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject } from "@/lib/projectAccess";
import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";

const PROVIDERS = new Set([
  "website_form",
  "google_lead_form",
  "generic_webhook",
  "channel_partner",
  "property_portal",
]);

function originList(value: unknown) {
  if (!Array.isArray(value)) return null;
  const values = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  for (const value of values) {
    if (value.startsWith("*.")) {
      if (!/^\*\.[a-z0-9.-]+$/i.test(value)) return null;
      continue;
    }
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value.replace(/\/$/, "")) {
        return null;
      }
    } catch {
      return null;
    }
  }
  return values;
}

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  try {
    const result = await pool.query(
      `SELECT form.form_id, form.project_id, form.integration_id,
              form.source_id, form.campaign_id, form.form_name, form.provider,
              form.public_key::text, form.provider_form_id, form.allowed_origins,
              form.field_mapping, form.lead_defaults, form.consent_notice,
              form.is_active, form.created_at, form.updated_at,
              project.project_name, project.project_code,
              source.source_name, campaign.campaign_name,
              integration.integration_name,
              COUNT(touchpoint.touchpoint_id)::integer AS touchpoint_count,
              COUNT(touchpoint.touchpoint_id) FILTER (WHERE touchpoint.lead_id IS NOT NULL)::integer AS lead_count
       FROM marketing_forms form
       JOIN projects project ON project.project_id=form.project_id
       LEFT JOIN lead_sources source ON source.source_id=form.source_id
       LEFT JOIN campaigns campaign ON campaign.campaign_id=form.campaign_id
       LEFT JOIN marketing_integrations integration ON integration.integration_id=form.integration_id
       LEFT JOIN marketing_touchpoints touchpoint ON touchpoint.form_id=form.form_id
       WHERE form.company_id=$1
       GROUP BY form.form_id, project.project_name, project.project_code,
                source.source_name, campaign.campaign_name,
                integration.integration_name
       ORDER BY form.created_at DESC`,
      [scope.context.access.company.company_id],
    );
    return NextResponse.json({ forms: result.rows });
  } catch (error) {
    console.error("Unable to list marketing forms", error);
    return NextResponse.json(
      { error: "Unable to retrieve marketing forms" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects) {
    return NextResponse.json(
      { error: "Company administrator access is required" },
      { status: 403 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isObject(body) || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 422 });
  }
  const projectId = Number(body.project_id);
  const name = typeof body.form_name === "string" ? body.form_name.trim() : "";
  const provider = typeof body.provider === "string" ? body.provider : "";
  const origins = originList(
    provider === "website_form" ? (body.allowed_origins ?? []) : [],
  );
  const errors: string[] = [];
  if (!Number.isSafeInteger(projectId) || !canAccessProject(scope.context.access, projectId)) {
    errors.push("Select an accessible project");
  }
  if (!name || name.length > 180) errors.push("form_name is required and must be at most 180 characters");
  if (!PROVIDERS.has(provider)) errors.push("provider is invalid");
  if (!origins) errors.push("allowed_origins must contain valid origins or wildcard domains");
  if (provider === "website_form" && origins?.length === 0) {
    errors.push("A website form requires at least one allowed origin");
  }
  if (
    provider === "google_lead_form" &&
    (typeof body.provider_form_id !== "string" || !body.provider_form_id.trim())
  ) {
    errors.push("A Google lead form requires its provider form ID");
  }
  const fieldMapping = isObject(body.field_mapping) && !Array.isArray(body.field_mapping) ? body.field_mapping : {};
  const leadDefaults = isObject(body.lead_defaults) && !Array.isArray(body.lead_defaults) ? body.lead_defaults : {};
  if (errors.length) {
    return NextResponse.json({ error: "Validation failed", details: errors }, { status: 422 });
  }
  const companyId = scope.context.access.company.company_id;
  const sourceId = typeof body.source_id === "string" && body.source_id ? body.source_id : null;
  const campaignId = typeof body.campaign_id === "string" && body.campaign_id ? body.campaign_id : null;
  const integrationId = typeof body.integration_id === "string" && body.integration_id ? body.integration_id : null;
  if (sourceId && !isUuid(sourceId)) errors.push("source_id must be a valid UUID");
  if (campaignId && !isUuid(campaignId)) errors.push("campaign_id must be a valid UUID");
  if (integrationId && !isUuid(integrationId)) errors.push("integration_id must be a valid UUID");
  if (errors.length) {
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  }
  try {
    const references = await pool.query(
      `SELECT
         ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM lead_sources WHERE company_id=$1 AND source_id=$2 AND is_active)) AS source_ok,
         ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM campaigns WHERE company_id=$1 AND campaign_id=$3 AND is_active)) AS campaign_ok,
         ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM marketing_integrations WHERE company_id=$1 AND integration_id=$4)) AS integration_ok`,
      [companyId, sourceId, campaignId, integrationId],
    );
    const refs = references.rows[0];
    if (!refs.source_ok || !refs.campaign_ok || !refs.integration_ok) {
      return NextResponse.json({ error: "A selected source, campaign, or integration is invalid" }, { status: 422 });
    }
    const submissionSecret = createMarketingSecret();
    const webhookSecret = provider === "google_lead_form" ? createMarketingSecret() : null;
    const inserted = await pool.query(
      `INSERT INTO marketing_forms (
         company_id, project_id, integration_id, source_id, campaign_id,
         form_name, provider, provider_form_id, submission_secret_hash,
         webhook_secret_hash, allowed_origins, field_mapping, lead_defaults,
         consent_notice, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$15)
       RETURNING form_id, project_id, integration_id, source_id, campaign_id,
                 form_name, provider, public_key::text, provider_form_id,
                 allowed_origins, field_mapping, lead_defaults, consent_notice,
                 is_active, created_at, updated_at`,
      [
        companyId,
        projectId,
        integrationId,
        sourceId,
        campaignId,
        name,
        provider,
        typeof body.provider_form_id === "string" && body.provider_form_id.trim() ? body.provider_form_id.trim().slice(0, 200) : null,
        hashMarketingSecret(submissionSecret),
        webhookSecret ? hashMarketingSecret(webhookSecret) : null,
        origins,
        JSON.stringify(fieldMapping),
        JSON.stringify(leadDefaults),
        typeof body.consent_notice === "string" ? body.consent_notice.trim().slice(0, 5000) || null : null,
        scope.context.userId,
      ],
    );
    return NextResponse.json(
      {
        form: inserted.rows[0],
        credentials: {
          submission_secret: submissionSecret,
          google_key: webhookSecret,
        },
        warning: "Copy these credentials now. They are stored as hashes and cannot be shown again.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Unable to create marketing form", error);
    return NextResponse.json({ error: "Unable to create marketing form" }, { status: 500 });
  }
}
