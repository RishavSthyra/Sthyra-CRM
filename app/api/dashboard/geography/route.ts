import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { buildLeadGeography } from "@/lib/leadGeography";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject, getAccessibleProjectIds } from "@/lib/projectAccess";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

const ALLOWED_RANGES = new Set([30, 90, 180, 365]);

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;

  const days = Number(request.nextUrl.searchParams.get("days") ?? 90);
  if (!ALLOWED_RANGES.has(days)) {
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
  const params = [projectIds, days];

  try {
    const [total, geography] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::integer AS leads_received
         FROM leads
         WHERE project_id = ANY($1::integer[])
           AND received_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')`,
        params,
      ),
      pool.query(
        `WITH lead_locations AS (
           SELECT
             NULLIF(BTRIM(COALESCE(
               CASE WHEN contact.latitude IS NOT NULL AND contact.longitude IS NOT NULL
                 THEN contact.country END,
               lead.qualification_data->>'geo_country',
               lead.qualification_data->>'country',
               contact.country
             )), '') AS country,
             NULLIF(BTRIM(COALESCE(
               CASE WHEN contact.latitude IS NOT NULL AND contact.longitude IS NOT NULL
                 THEN contact.state END,
               lead.qualification_data->>'geo_state',
               lead.qualification_data->>'state',
               contact.state
             )), '') AS state,
             CASE
               WHEN contact.latitude IS NOT NULL AND contact.longitude IS NOT NULL
               THEN NULL
               ELSE NULLIF(BTRIM(COALESCE(
                 lead.qualification_data->>'geo_district',
                 lead.qualification_data->>'district',
                 contact.district
               )), '')
             END AS district,
             NULLIF(BTRIM(COALESCE(
               CASE WHEN contact.latitude IS NOT NULL AND contact.longitude IS NOT NULL
                 THEN contact.city END,
               lead.qualification_data->>'geo_city',
               lead.qualification_data->>'city',
               contact.city
             )), '') AS city,
             CASE
               WHEN contact.latitude IS NOT NULL AND contact.longitude IS NOT NULL
               THEN contact.latitude
               WHEN COALESCE(
                 lead.qualification_data->>'geo_latitude',
                 lead.qualification_data->>'latitude'
               ) ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
               THEN COALESCE(
                 lead.qualification_data->>'geo_latitude',
                 lead.qualification_data->>'latitude'
               )::numeric
               ELSE contact.latitude
             END AS latitude,
             CASE
               WHEN contact.latitude IS NOT NULL AND contact.longitude IS NOT NULL
               THEN contact.longitude
               WHEN COALESCE(
                 lead.qualification_data->>'geo_longitude',
                 lead.qualification_data->>'longitude'
               ) ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
               THEN COALESCE(
                 lead.qualification_data->>'geo_longitude',
                 lead.qualification_data->>'longitude'
               )::numeric
               ELSE contact.longitude
             END AS longitude
           FROM leads lead
           JOIN contacts contact ON contact.contact_id=lead.contact_id
           WHERE lead.project_id = ANY($1::integer[])
             AND lead.received_at >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')
         )
         SELECT country, state, district, city, latitude, longitude,
                COUNT(*)::integer AS leads
         FROM lead_locations
         GROUP BY country, state, district, city, latitude, longitude`,
        params,
      ),
    ]);

    const leadsReceived = Number(total.rows[0]?.leads_received ?? 0);
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      lead_geography: buildLeadGeography(geography.rows, leadsReceived),
    });
  } catch (error) {
    console.error("Failed to load dashboard geography", error);
    return NextResponse.json(
      { error: "Unable to load lead geography" },
      { status: 500 },
    );
  }
}
