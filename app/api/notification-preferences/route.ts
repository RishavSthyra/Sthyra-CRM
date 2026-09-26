import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ensureNotificationPreferences, validateNotificationPreferences } from "@/lib/notifications";
import { requireOperationsContext } from "@/lib/operationsAccess";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  try { return NextResponse.json({ preferences: await ensureNotificationPreferences(pool, scope.context.userId) }); }
  catch (error) { console.error("Failed to retrieve notification preferences", error); return NextResponse.json({ error: "Unable to retrieve notification preferences" }, { status: 500 }); }
}

export async function PATCH(request: NextRequest) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 }); }
  const validation = validateNotificationPreferences(body);
  if (!validation.ok) return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  try {
    await ensureNotificationPreferences(pool, scope.context.userId);
    const entries = Object.entries(validation.data);
    const values = entries.map(([, value]) => value); values.push(scope.context.userId);
    const result = await pool.query(`UPDATE notification_preferences SET ${entries.map(([key], index) => `${key}=$${index + 1}`).join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE user_id=$${values.length} RETURNING *`, values);
    return NextResponse.json({ message: "Notification preferences updated", preferences: result.rows[0] });
  } catch (error) { console.error("Failed to update notification preferences", error); return NextResponse.json({ error: "Unable to update notification preferences" }, { status: 500 }); }
}
