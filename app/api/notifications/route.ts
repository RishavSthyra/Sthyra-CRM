import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { NOTIFICATION_COLUMNS } from "@/lib/notifications";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams, 30, 100);
  if (!pagination.ok) return NextResponse.json({ error: pagination.error }, { status: 400 });
  const values: unknown[] = [scope.context.userId];
  const filters = ["n.user_id=$1", "(n.expires_at IS NULL OR n.expires_at>CURRENT_TIMESTAMP)"];
  const unread = request.nextUrl.searchParams.get("unread");
  if (unread !== null) {
    if (!["true", "false"].includes(unread)) return NextResponse.json({ error: "unread must be true or false" }, { status: 400 });
    values.push(unread === "true"); filters.push(`n.is_read<>$${values.length}`);
  }
  const type = request.nextUrl.searchParams.get("type")?.trim();
  if (type) { values.push(type); filters.push(`n.notification_type=$${values.length}`); }
  try {
    const where = `WHERE ${filters.join(" AND ")}`;
    const count = await pool.query(`SELECT COUNT(*)::integer AS total FROM notifications n ${where}`, values);
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${NOTIFICATION_COLUMNS} FROM notifications n ${where}
       ORDER BY n.created_at DESC, n.notification_id DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`, listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({ notifications: result.rows, pagination: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) } });
  } catch (error) {
    console.error("Failed to list notifications", error);
    return NextResponse.json({ error: "Unable to retrieve notifications" }, { status: 500 });
  }
}
