import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOperationsContext } from "@/lib/operationsAccess";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::integer AS unread_count FROM notifications
       WHERE user_id=$1 AND is_read=FALSE AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)`,
      [scope.context.userId],
    );
    return NextResponse.json({ unread_count: Number(result.rows[0]?.unread_count ?? 0) });
  } catch (error) {
    console.error("Failed to count unread notifications", error);
    return NextResponse.json({ error: "Unable to retrieve unread count" }, { status: 500 });
  }
}
