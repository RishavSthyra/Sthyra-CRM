import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseNotificationUuid } from "@/lib/notifications";
import { requireOperationsContext } from "@/lib/operationsAccess";

type Context = { params: Promise<{ deliveryid: string }> };
export async function POST(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  const id = parseNotificationUuid((await context.params).deliveryid);
  if (!id) return NextResponse.json({ error: "deliveryId must be a valid UUID" }, { status: 400 });
  try {
    const result = await pool.query(
      `UPDATE notification_deliveries SET status='queued', next_attempt_at=CURRENT_TIMESTAMP,
       error_message=NULL, failed_at=NULL, updated_at=CURRENT_TIMESTAMP
       WHERE delivery_id=$1 AND user_id=$2 AND status='failed' AND attempt_count<max_attempts RETURNING *`, [id, scope.context.userId],
    );
    if (!result.rowCount) {
      const found = await pool.query("SELECT status, attempt_count, max_attempts FROM notification_deliveries WHERE delivery_id=$1 AND user_id=$2", [id, scope.context.userId]);
      if (!found.rowCount) return NextResponse.json({ error: "Notification delivery not found" }, { status: 404 });
      return NextResponse.json({ error: "Only failed deliveries with retries remaining can be retried" }, { status: 409 });
    }
    return NextResponse.json({ message: "Notification delivery queued for retry", delivery: result.rows[0] });
  } catch (error) { console.error("Failed to retry notification delivery", error); return NextResponse.json({ error: "Unable to retry notification delivery" }, { status: 500 }); }
}
