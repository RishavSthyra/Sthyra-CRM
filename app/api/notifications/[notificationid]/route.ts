import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { NOTIFICATION_COLUMNS, parseNotificationUuid } from "@/lib/notifications";
import { requireOperationsContext } from "@/lib/operationsAccess";

type Context = { params: Promise<{ notificationid: string }> };
export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const id = parseNotificationUuid((await context.params).notificationid);
  if (!id) return NextResponse.json({ error: "notificationId must be a valid UUID" }, { status: 400 });
  try {
    const result = await pool.query(`SELECT ${NOTIFICATION_COLUMNS} FROM notifications n WHERE n.notification_id=$1 AND n.user_id=$2`, [id, scope.context.userId]);
    if (!result.rowCount) return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    return NextResponse.json({ notification: result.rows[0] });
  } catch (error) {
    console.error("Failed to retrieve notification", error);
    return NextResponse.json({ error: "Unable to retrieve notification" }, { status: 500 });
  }
}
