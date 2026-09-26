import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOperationsContext } from "@/lib/operationsAccess";

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  try {
    const result = await pool.query(
      `UPDATE notifications SET is_read=TRUE, read_at=CURRENT_TIMESTAMP
       WHERE user_id=$1 AND is_read=FALSE RETURNING notification_id`, [scope.context.userId],
    );
    return NextResponse.json({ message: "All notifications marked as read", updated_count: result.rowCount ?? 0 });
  } catch (error) {
    console.error("Failed to read all notifications", error);
    return NextResponse.json({ error: "Unable to mark notifications as read" }, { status: 500 });
  }
}
