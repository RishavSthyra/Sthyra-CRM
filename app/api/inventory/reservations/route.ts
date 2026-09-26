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
    !["active", "converted", "cancelled", "expired"].includes(status)
  )
    return NextResponse.json(
      { error: "Invalid reservation status" },
      { status: 400 },
    );
  const values: unknown[] = [projectId];
  let filter = "";
  if (status) {
    values.push(status);
    filter = ` AND reservation.status=$2`;
  }
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM inventory_reservations reservation WHERE reservation.project_id=$1${filter}`,
      values,
    );
    const result = await pool.query(
      `SELECT reservation.*,iu.unit_code,iu.unit_name,ut.type_code,ut.type_name,o.opportunity_name,c.first_name,c.last_name,c.email FROM inventory_reservations reservation JOIN inventory_units iu ON iu.unit_id=reservation.unit_id LEFT JOIN inventory_unit_types ut ON ut.unit_type_id=iu.unit_type_id JOIN opportunities o ON o.opportunity_id=reservation.opportunity_id JOIN contacts c ON c.contact_id=o.contact_id WHERE reservation.project_id=$1${filter} ORDER BY reservation.created_at DESC,reservation.reservation_id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pagination.limit, pagination.offset],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      reservations: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve inventory reservations", error);
    return NextResponse.json(
      { error: "Unable to retrieve inventory reservations" },
      { status: 500 },
    );
  }
}
