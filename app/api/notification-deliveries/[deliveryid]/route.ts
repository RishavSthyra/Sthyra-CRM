import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { DELIVERY_COLUMNS, parseNotificationUuid } from "@/lib/notifications";
import { requireOperationsContext } from "@/lib/operationsAccess";

type Context = { params: Promise<{ deliveryid: string }> };
export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  const id = parseNotificationUuid((await context.params).deliveryid);
  if (!id) return NextResponse.json({ error: "deliveryId must be a valid UUID" }, { status: 400 });
  try {
    const result = await pool.query(`SELECT ${DELIVERY_COLUMNS} FROM notification_deliveries nd WHERE nd.delivery_id=$1 AND nd.user_id=$2`, [id, scope.context.userId]);
    if (!result.rowCount) return NextResponse.json({ error: "Notification delivery not found" }, { status: 404 });
    return NextResponse.json({ delivery: result.rows[0] });
  } catch (error) { console.error("Failed to retrieve notification delivery", error); return NextResponse.json({ error: "Unable to retrieve notification delivery" }, { status: 500 }); }
}
