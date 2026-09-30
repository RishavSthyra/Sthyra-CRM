import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/authorization";
import { canAccessProject, getAccessibleProjectIds } from "@/lib/projectAccess";
import { serializeCsv } from "@/lib/dataTransfer";

const EXPORTS = {
  contacts: {
    select: `contact_id, first_name, last_name, email, phone_number,
             alternate_phone_number, country, company_works_at, address,
             created_at, updated_at`,
    from: "contacts",
    company: "company_id",
    project: null,
    active: "archived_at IS NULL",
    order: "created_at DESC",
  },
  leads: {
    select: `lead_id, contact_id, project_id, source_id, campaign_id, status,
             temperature, customer_type, preferred_location, preferred_config,
             budget, buying_reason, received_at, created_at, updated_at`,
    from: "leads",
    company: "company_id",
    project: "project_id",
    active: "TRUE",
    order: "created_at DESC",
  },
  opportunities: {
    select: `opportunity_id, lead_id, contact_id, project_id, opportunity_name,
             stage_key, status, amount, probability, expected_close_date,
             outcome, created_at, updated_at`,
    from: "opportunities",
    company: "company_id",
    project: "project_id",
    active: "TRUE",
    order: "created_at DESC",
  },
} as const;

export async function GET(request: NextRequest) {
  const scope = await requirePermission(request, "DATA_EXPORT");
  if (!scope.ok) return scope.response;
  const entity = request.nextUrl.searchParams.get("entity") ?? "leads";
  if (!(entity in EXPORTS)) {
    return NextResponse.json({ error: "entity must be contacts, leads, or opportunities" }, { status: 400 });
  }
  const format = request.nextUrl.searchParams.get("format") ?? "csv";
  if (format !== "csv" && format !== "json") {
    return NextResponse.json({ error: "format must be csv or json" }, { status: 400 });
  }
  const definition = EXPORTS[entity as keyof typeof EXPORTS];
  const values: unknown[] = [scope.context.access.company.company_id];
  const filters = [`${definition.company} = $1`, definition.active];
  if (definition.project) {
    const requestedProject = request.nextUrl.searchParams.get("project_id");
    if (requestedProject && requestedProject !== "all") {
      const projectId = Number(requestedProject);
      if (!Number.isSafeInteger(projectId) || !canAccessProject(scope.context.access, projectId)) {
        return NextResponse.json({ error: "Project not found or inaccessible" }, { status: 403 });
      }
      values.push(projectId);
      filters.push(`${definition.project} = $${values.length}`);
    } else {
      values.push(getAccessibleProjectIds(scope.context.access));
      filters.push(`${definition.project} = ANY($${values.length}::integer[])`);
    }
  }
  values.push(10_000);
  const result = await pool.query(
    `SELECT ${definition.select}
     FROM ${definition.from}
     WHERE ${filters.join(" AND ")}
     ORDER BY ${definition.order}
     LIMIT $${values.length}`,
    values,
  );
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `sthyra-${entity}-${stamp}.${format}`;
  const response = format === "csv"
    ? new NextResponse(serializeCsv(result.rows), {
        headers: { "Content-Type": "text/csv; charset=utf-8" },
      })
    : NextResponse.json({ entity, exported_at: new Date().toISOString(), rows: result.rows });
  response.headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
