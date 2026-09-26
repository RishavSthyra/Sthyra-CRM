import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseInventoryUuid } from "@/lib/inventory";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { parsePagination } from "@/utils/parsePagination";
type Context = { params: Promise<{ importid: string }> };
export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const id = parseInventoryUuid((await context.params).importid);
  if (!id)
    return NextResponse.json(
      { error: "importId must be a valid UUID" },
      { status: 400 },
    );
  const pagination = parsePagination(request.nextUrl.searchParams, 100, 500);
  if (!pagination.ok)
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  try {
    const job = await pool.query(
      "SELECT * FROM inventory_import_jobs WHERE import_id=$1",
      [id],
    );
    if (!job.rowCount)
      return NextResponse.json(
        { error: "Inventory import not found" },
        { status: 404 },
      );
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(job.rows[0].company_id),
        Number(job.rows[0].project_id),
      )
    )
      return NextResponse.json(
        { error: "You do not have access to this inventory import" },
        { status: 403 },
      );
    const status = request.nextUrl.searchParams.get("status");
    const values: unknown[] = [id];
    let filter = "";
    if (status) {
      if (!["pending", "valid", "imported", "failed"].includes(status))
        return NextResponse.json(
          { error: "Invalid import row status" },
          { status: 400 },
        );
      values.push(status);
      filter = " AND status=$2";
    }
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM inventory_import_rows WHERE import_id=$1${filter}`,
      values,
    );
    const rows = await pool.query(
      `SELECT * FROM inventory_import_rows WHERE import_id=$1${filter} ORDER BY row_number LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pagination.limit, pagination.offset],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      import: job.rows[0],
      rows: rows.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve inventory import", error);
    return NextResponse.json(
      { error: "Unable to retrieve inventory import" },
      { status: 500 },
    );
  }
}
