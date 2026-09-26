import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseNotificationUuid } from "@/lib/notifications";
import { requireOperationsContext } from "@/lib/operationsAccess";

type Context = { params: Promise<{ notificationid: string }> };
export async function POST(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  const id = parseNotificationUuid((await context.params).notificationid);
  if (!id) return NextResponse.json({ error: "notificationId must be a valid UUID" }, { status: 400 });
  try {
    const result = await pool.query(`UPDATE notifications SET is_read=FALSE, read_at=NULL WHERE notification_id=$1 AND user_id=$2 RETURNING *`, [id, scope.context.userId]);
    if (!result.rowCount) return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    return NextResponse.json({ message: "Notification marked as unread", notification: result.rows[0] });
  } catch (error) { console.error("Failed to mark notification unread", error); return NextResponse.json({ error: "Unable to update notification" }, { status: 500 }); }
}
