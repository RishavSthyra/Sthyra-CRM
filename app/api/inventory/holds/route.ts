import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseProjectForAccess } from "@/lib/inventory";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { parsePagination } from "@/utils/parsePagination";
export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams, 30, 100);
  if (!pagination.ok)
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  const projectId = parseProjectForAccess(
    request.nextUrl.searchParams.get("project_id"),
    scope.context.access,
  );
  if (!projectId)
    return NextResponse.json(
      { error: "A valid accessible project_id is required" },
      { status: 400 },
    );
  const status = request.nextUrl.searchParams.get("status");
  if (
    status &&
    !["active", "released", "expired", "converted", "cancelled"].includes(
      status,
    )
  )
    return NextResponse.json({ error: "Invalid hold status" }, { status: 400 });
  const values: unknown[] = [projectId];
  let filter = "";
  if (status) {
    values.push(status);
    filter = ` AND hold.status=$2`;
  }
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM inventory_holds hold WHERE hold.project_id=$1${filter}`,
      values,
    );
    const result = await pool.query(
      `SELECT hold.*,iu.unit_code,iu.unit_name,ut.type_code,ut.type_name,o.opportunity_name,c.first_name,c.last_name,c.email FROM inventory_holds hold JOIN inventory_units iu ON iu.unit_id=hold.unit_id LEFT JOIN inventory_unit_types ut ON ut.unit_type_id=iu.unit_type_id LEFT JOIN opportunities o ON o.opportunity_id=hold.opportunity_id LEFT JOIN leads l ON l.lead_id=COALESCE(hold.lead_id,o.lead_id) LEFT JOIN contacts c ON c.contact_id=l.contact_id WHERE hold.project_id=$1${filter} ORDER BY hold.created_at DESC,hold.hold_id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pagination.limit, pagination.offset],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      holds: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve inventory holds", error);
    return NextResponse.json(
      { error: "Unable to retrieve inventory holds" },
      { status: 500 },
    );
  }
}
