import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { getAccessibleProjectIds } from "@/lib/projectAccess";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const companyId = scope.context.access.company.company_id;
  const projectIds = getAccessibleProjectIds(scope.context.access);
  const requestedProject = Number(request.nextUrl.searchParams.get("project_id"));
  const selected = Number.isSafeInteger(requestedProject) && projectIds.includes(requestedProject) ? requestedProject : null;
  const days = Math.min(365, Math.max(7, Number(request.nextUrl.searchParams.get("days")) || 30));
  try {
    const [summary, trend, sources, touchpoints, conversions, references] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::integer AS touchpoints,
           COUNT(DISTINCT anonymous_visitor_id)::integer AS visitors,
           COUNT(*) FILTER (WHERE lead_id IS NOT NULL)::integer AS lead_touchpoints,
           COUNT(DISTINCT lead_id)::integer AS attributed_leads,
           COUNT(*) FILTER (WHERE event_type='form_submit' OR event_type='lead_generated')::integer AS submissions
         FROM marketing_touchpoints
         WHERE company_id=$1 AND ($2::integer IS NULL OR project_id=$2)
           AND occurred_at >= CURRENT_TIMESTAMP - ($3 * INTERVAL '1 day')`,
        [companyId, selected, days],
      ),
      pool.query(
        `SELECT DATE_TRUNC('day',occurred_at)::date::text AS day,
                COUNT(*)::integer AS touchpoints,
                COUNT(DISTINCT lead_id)::integer AS leads
         FROM marketing_touchpoints
         WHERE company_id=$1 AND ($2::integer IS NULL OR project_id=$2)
           AND occurred_at >= CURRENT_TIMESTAMP - ($3 * INTERVAL '1 day')
         GROUP BY 1 ORDER BY 1`,
        [companyId, selected, days],
      ),
      pool.query(
        `SELECT COALESCE(source.source_name,touchpoint.utm_source,'Direct / unknown') AS source_name,
                COUNT(*)::integer AS touchpoints,
                COUNT(DISTINCT touchpoint.lead_id)::integer AS leads
         FROM marketing_touchpoints touchpoint
         LEFT JOIN lead_sources source ON source.source_id=touchpoint.source_id
         WHERE touchpoint.company_id=$1 AND ($2::integer IS NULL OR touchpoint.project_id=$2)
           AND touchpoint.occurred_at >= CURRENT_TIMESTAMP - ($3 * INTERVAL '1 day')
         GROUP BY 1 ORDER BY leads DESC, touchpoints DESC LIMIT 8`,
        [companyId, selected, days],
      ),
      pool.query(
        `SELECT touchpoint.touchpoint_id, touchpoint.event_type, touchpoint.provider,
                touchpoint.channel, touchpoint.utm_source, touchpoint.utm_campaign,
                touchpoint.landing_page_url, touchpoint.occurred_at,
                touchpoint.lead_id, project.project_name, form.form_name,
                TRIM(CONCAT(contact.first_name,' ',contact.last_name)) AS contact_name
         FROM marketing_touchpoints touchpoint
         JOIN projects project ON project.project_id=touchpoint.project_id
         LEFT JOIN marketing_forms form ON form.form_id=touchpoint.form_id
         LEFT JOIN contacts contact ON contact.contact_id=touchpoint.contact_id
         WHERE touchpoint.company_id=$1 AND ($2::integer IS NULL OR touchpoint.project_id=$2)
         ORDER BY touchpoint.occurred_at DESC LIMIT 80`,
        [companyId, selected],
      ),
      pool.query(
        `SELECT job.conversion_job_id, job.event_name, job.transaction_id,
                job.status, job.attempt_count, job.last_error, job.sent_at,
                job.created_at, integration.integration_name, project.project_name
         FROM marketing_conversion_jobs job
         JOIN marketing_integrations integration ON integration.integration_id=job.integration_id
         JOIN projects project ON project.project_id=job.project_id
         WHERE job.company_id=$1 AND ($2::integer IS NULL OR job.project_id=$2)
         ORDER BY job.created_at DESC LIMIT 60`,
        [companyId, selected],
      ),
      Promise.all([
        pool.query("SELECT project_id, project_name, project_code FROM projects WHERE company_id=$1 AND is_active ORDER BY project_name", [companyId]),
        pool.query("SELECT source_id, source_name, source_type FROM lead_sources WHERE company_id=$1 AND is_active ORDER BY source_name", [companyId]),
        pool.query("SELECT campaign_id, campaign_name, source_id FROM campaigns WHERE company_id=$1 AND is_active ORDER BY campaign_name", [companyId]),
      ]),
    ]);
    const item = summary.rows[0] ?? {};
    const visitorCount = Number(item.visitors ?? 0);
    const leads = Number(item.attributed_leads ?? 0);
    return NextResponse.json({
      summary: { ...item, conversion_rate: visitorCount ? (leads / visitorCount) * 100 : 0, days },
      trend: trend.rows,
      sources: sources.rows,
      touchpoints: touchpoints.rows,
      conversions: conversions.rows,
      projects: references[0].rows,
      lead_sources: references[1].rows,
      campaigns: references[2].rows,
      selected_project_id: selected,
    });
  } catch (error) {
    console.error("Unable to load marketing overview", error);
    return NextResponse.json({ error: "Unable to load marketing analytics" }, { status: 500 });
  }
}

