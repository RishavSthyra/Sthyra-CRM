import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject, getAccessibleProjectIds } from "@/lib/projectAccess";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

const ALLOWED_RANGES = new Set([30, 90, 180, 365]);

function numericRows(rows: Array<Record<string, unknown>>) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)
          ? Number(value)
          : value,
      ]),
    ),
  );
}

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;

  const rangeParam = Number(request.nextUrl.searchParams.get("days") ?? 90);
  if (!ALLOWED_RANGES.has(rangeParam)) {
    return NextResponse.json(
      { error: "days must be one of: 30, 90, 180, 365" },
      { status: 400 },
    );
  }

  const projectParam = request.nextUrl.searchParams.get("project_id");
  const projectId = projectParam ? parsePositiveInteger(projectParam) : null;
  if (
    projectParam &&
    (!projectId || !canAccessProject(scope.context.access, projectId))
  ) {
    return NextResponse.json(
      { error: "Invalid or inaccessible project_id" },
      { status: 400 },
    );
  }

  const projectIds = projectId
    ? [projectId]
    : getAccessibleProjectIds(scope.context.access);
  const params = [projectIds, rangeParam];
  const projectFilter = "= ANY($1::integer[])";
  const client = await pool.connect();

  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const [
      summary,
      stages,
      sources,
      funnel,
      owners,
      inventoryMix,
      inventoryMovement,
      visitOutcomes,
      revenueForecast,
      monthlyTrend,
    ] = await Promise.all([
      client.query(
        `SELECT
           (SELECT COUNT(*) FROM opportunities o WHERE o.project_id ${projectFilter} AND o.status='open')::integer AS open_opportunities,
           COALESCE((SELECT SUM(o.amount) FROM opportunities o WHERE o.project_id ${projectFilter} AND o.status='open'), 0) AS pipeline_value,
           COALESCE((SELECT SUM(COALESCE(o.amount,0) * o.probability / 100.0) FROM opportunities o WHERE o.project_id ${projectFilter} AND o.status='open'), 0) AS weighted_value,
           COALESCE((SELECT SUM(o.amount) FROM opportunities o WHERE o.project_id ${projectFilter} AND o.status='closed' AND o.outcome='won' AND o.closed_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')), 0) AS won_revenue,
           (SELECT COUNT(*) FROM leads l WHERE l.project_id ${projectFilter} AND l.received_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day'))::integer AS leads_received,
           (SELECT COUNT(*) FROM leads l WHERE l.project_id ${projectFilter} AND l.qualified_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day'))::integer AS leads_qualified,
           (SELECT COUNT(*) FROM appointments a WHERE a.project_id ${projectFilter} AND a.appointment_type='site_visit' AND a.status='completed' AND a.completed_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day'))::integer AS completed_site_visits,
           (SELECT COUNT(DISTINCT a.appointment_id)
              FROM appointments a
              LEFT JOIN opportunities o ON o.opportunity_id=a.opportunity_id
             WHERE a.project_id ${projectFilter}
               AND a.appointment_type='site_visit'
               AND a.status='completed'
               AND a.completed_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')
               AND (o.outcome='won' OR EXISTS (
                 SELECT 1 FROM inventory_reservations reservation
                 WHERE reservation.opportunity_id=a.opportunity_id
                   AND reservation.status='converted'
               )))::integer AS converted_site_visits,
           (SELECT COUNT(*) FROM inventory_units u WHERE u.project_id ${projectFilter})::integer AS total_inventory,
           (SELECT COUNT(*) FROM inventory_units u WHERE u.project_id ${projectFilter} AND u.status='available')::integer AS available_inventory`,
        params,
      ),
      client.query(
        `SELECT
           stage.stage_key,
           stage.stage_name,
           stage.position,
           stage.color,
           COUNT(opportunity.opportunity_id)::integer AS opportunity_count,
           COALESCE(SUM(opportunity.amount),0) AS pipeline_value,
           COALESCE(SUM(COALESCE(opportunity.amount,0) * opportunity.probability / 100.0),0) AS weighted_value
         FROM project_opportunity_stages stage
         LEFT JOIN opportunities opportunity
           ON opportunity.project_id=stage.project_id
          AND opportunity.stage_key=stage.stage_key
          AND opportunity.status='open'
         WHERE stage.project_id ${projectFilter} AND stage.is_active=TRUE
         GROUP BY stage.stage_key, stage.stage_name, stage.position, stage.color
         ORDER BY MIN(stage.position), stage.stage_name`,
        [projectIds],
      ),
      client.query(
        `SELECT
           COALESCE(source.source_name,'Unknown') AS source_name,
           COUNT(lead.lead_id)::integer AS leads,
           COUNT(lead.lead_id) FILTER (WHERE lead.qualified_at IS NOT NULL)::integer AS qualified,
           COUNT(opportunity.opportunity_id) FILTER (WHERE opportunity.outcome='won')::integer AS won,
           COALESCE(SUM(opportunity.amount) FILTER (WHERE opportunity.status='open'),0) AS pipeline_value
         FROM leads lead
         LEFT JOIN lead_sources source ON source.source_id=lead.source_id
         LEFT JOIN opportunities opportunity ON opportunity.lead_id=lead.lead_id
         WHERE lead.project_id ${projectFilter}
           AND lead.received_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')
         GROUP BY COALESCE(source.source_name,'Unknown')
         ORDER BY qualified DESC, leads DESC
         LIMIT 10`,
        params,
      ),
      client.query(
        `SELECT stage, stage_order, records FROM (
           SELECT 'Leads' AS stage, 1 AS stage_order,
             COUNT(*)::integer AS records
           FROM leads lead
           WHERE lead.project_id ${projectFilter}
             AND lead.received_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')
           UNION ALL
           SELECT 'Qualified', 2, COUNT(*)::integer
           FROM leads lead
           WHERE lead.project_id ${projectFilter}
             AND lead.qualified_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')
           UNION ALL
           SELECT 'Site visits', 3, COUNT(*)::integer
           FROM appointments appointment
           WHERE appointment.project_id ${projectFilter}
             AND appointment.appointment_type='site_visit'
             AND appointment.status='completed'
             AND appointment.completed_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')
           UNION ALL
           SELECT 'Quotations', 4, COUNT(*)::integer
           FROM opportunity_quotations quotation
           JOIN opportunities opportunity ON opportunity.opportunity_id=quotation.opportunity_id
           WHERE opportunity.project_id ${projectFilter}
             AND quotation.created_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')
           UNION ALL
           SELECT 'Bookings', 5, COUNT(*)::integer
           FROM inventory_reservations reservation
           WHERE reservation.project_id ${projectFilter}
             AND reservation.status='converted'
             AND reservation.updated_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')
           UNION ALL
           SELECT 'Won', 6, COUNT(*)::integer
           FROM opportunities opportunity
           WHERE opportunity.project_id ${projectFilter}
             AND opportunity.outcome='won'
             AND opportunity.closed_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')
         ) conversion ORDER BY stage_order`,
        params,
      ),
      client.query(
        `SELECT
           user_record.user_id,
           TRIM(CONCAT(user_record.first_name,' ',user_record.last_name)) AS owner_name,
           COUNT(opportunity.opportunity_id) FILTER (WHERE opportunity.status='open')::integer AS open_opportunities,
           COALESCE(SUM(opportunity.amount) FILTER (WHERE opportunity.status='open'),0) AS pipeline_value,
           COUNT(opportunity.opportunity_id) FILTER (WHERE opportunity.outcome='won' AND opportunity.closed_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day'))::integer AS won,
           COALESCE(SUM(opportunity.amount) FILTER (WHERE opportunity.outcome='won' AND opportunity.closed_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')),0) AS won_revenue,
           COUNT(opportunity.opportunity_id) FILTER (WHERE opportunity.closed_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day'))::integer AS closed
         FROM users user_record
         JOIN teams team_record ON team_record.team_id=user_record.team_id
         LEFT JOIN opportunities opportunity
           ON opportunity.current_owner_user_id=user_record.user_id
          AND opportunity.project_id ${projectFilter}
         WHERE team_record.company_id=$3
           AND user_record.is_active=TRUE
           AND user_record.deleted_at IS NULL
         GROUP BY user_record.user_id, user_record.first_name, user_record.last_name
         HAVING COUNT(opportunity.opportunity_id)>0
         ORDER BY won_revenue DESC, pipeline_value DESC
         LIMIT 10`,
        [projectIds, rangeParam, scope.context.access.company.company_id],
      ),
      client.query(
        `SELECT status, COUNT(*)::integer AS units
         FROM inventory_units
         WHERE project_id ${projectFilter}
         GROUP BY status ORDER BY units DESC`,
        [projectIds],
      ),
      client.query(
        `SELECT
           TO_CHAR(DATE_TRUNC('month', history.created_at),'YYYY-MM') AS month,
           history.to_status AS status,
           COUNT(*)::integer AS movements
         FROM inventory_unit_status_history history
         JOIN inventory_units unit_record ON unit_record.unit_id=history.unit_id
         WHERE unit_record.project_id ${projectFilter}
           AND history.created_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')
         GROUP BY DATE_TRUNC('month', history.created_at), history.to_status
         ORDER BY DATE_TRUNC('month', history.created_at), history.to_status`,
        params,
      ),
      client.query(
        `SELECT
           COALESCE(visit.outcome,
             CASE WHEN appointment.status='no_show' THEN 'no_show'
                  WHEN appointment.status='cancelled' THEN 'cancelled'
                  ELSE 'pending' END) AS outcome,
           COUNT(*)::integer AS visits
         FROM appointments appointment
         JOIN site_visits visit ON visit.visit_id=appointment.appointment_id
         WHERE appointment.project_id ${projectFilter}
           AND appointment.starts_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')
         GROUP BY 1 ORDER BY visits DESC`,
        params,
      ),
      client.query(
        `WITH months AS (
           SELECT GENERATE_SERIES(
             DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months',
             DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '6 months',
             INTERVAL '1 month'
           ) AS month
         )
         SELECT
           TO_CHAR(months.month,'YYYY-MM') AS month,
           COALESCE(SUM(opportunity.amount) FILTER (
             WHERE opportunity.status='closed' AND opportunity.outcome='won'
               AND DATE_TRUNC('month',opportunity.closed_at)=months.month
           ),0) AS actual_revenue,
           COALESCE(SUM(COALESCE(opportunity.amount,0) * opportunity.probability / 100.0) FILTER (
             WHERE opportunity.status='open'
               AND DATE_TRUNC('month',opportunity.expected_close_date)=months.month
           ),0) AS weighted_forecast
         FROM months
         LEFT JOIN opportunities opportunity ON opportunity.project_id ${projectFilter}
         GROUP BY months.month ORDER BY months.month`,
        [projectIds],
      ),
      client.query(
        `WITH months AS (
           SELECT GENERATE_SERIES(
             DATE_TRUNC('month', CURRENT_DATE - ($2 * INTERVAL '1 day')),
             DATE_TRUNC('month', CURRENT_DATE),
             INTERVAL '1 month'
           ) AS month
         )
         SELECT
           TO_CHAR(months.month,'YYYY-MM') AS month,
           COUNT(DISTINCT lead.lead_id)::integer AS leads,
           COUNT(DISTINCT opportunity.opportunity_id) FILTER (WHERE opportunity.outcome='won')::integer AS wins
         FROM months
         LEFT JOIN leads lead
           ON lead.project_id ${projectFilter}
          AND DATE_TRUNC('month',lead.received_at)=months.month
         LEFT JOIN opportunities opportunity
           ON opportunity.project_id ${projectFilter}
          AND DATE_TRUNC('month',opportunity.closed_at)=months.month
         GROUP BY months.month ORDER BY months.month`,
        params,
      ),
    ]);

    await client.query("COMMIT");
    const summaryRow = numericRows(summary.rows)[0] ?? {};
    const leadsReceived = Number(summaryRow.leads_received ?? 0);
    const leadsQualified = Number(summaryRow.leads_qualified ?? 0);
    const completedVisits = Number(summaryRow.completed_site_visits ?? 0);
    const convertedVisits = Number(summaryRow.converted_site_visits ?? 0);

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      filters: { days: rangeParam, project_id: projectId },
      projects: scope.context.access.projects,
      summary: {
        ...summaryRow,
        lead_conversion_rate: leadsReceived
          ? (leadsQualified / leadsReceived) * 100
          : 0,
        site_visit_conversion_rate: completedVisits
          ? (convertedVisits / completedVisits) * 100
          : 0,
      },
      pipeline_by_stage: numericRows(stages.rows),
      source_performance: numericRows(sources.rows).map((row) => ({
        ...row,
        conversion_rate: Number(row.leads)
          ? (Number(row.qualified) / Number(row.leads)) * 100
          : 0,
      })),
      owner_performance: numericRows(owners.rows).map((row) => ({
        ...row,
        win_rate: Number(row.closed)
          ? (Number(row.won) / Number(row.closed)) * 100
          : 0,
      })),
      inventory_mix: numericRows(inventoryMix.rows),
      inventory_movement: numericRows(inventoryMovement.rows),
      site_visit_outcomes: numericRows(visitOutcomes.rows),
      revenue_forecast: numericRows(revenueForecast.rows),
      monthly_trend: numericRows(monthlyTrend.rows),
      conversion_funnel: numericRows(funnel.rows),
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to load dashboard analytics", error);
    return NextResponse.json(
      { error: "Unable to load dashboard analytics" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
