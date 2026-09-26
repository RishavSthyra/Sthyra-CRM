import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireTransfer } from "@/lib/transferAccess";
import { parseUuid } from "@/lib/operations";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

type Context = { params: Promise<{ transferid: string }> };

export async function GET(request: NextRequest, context: Context) {
  const access = await requireTransfer(request, (await context.params).transferid);
  if (!access.ok) return access.response;
  try {
    const result = await pool.query(
      `SELECT ci.*,
        CASE WHEN u.user_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
          'user_id', u.user_id, 'first_name', u.first_name,
          'last_name', u.last_name
        ) END AS completed_by_user
       FROM transfer_checklist_items ci
       LEFT JOIN users u ON u.user_id=ci.completed_by
       WHERE ci.transfer_id=$1 ORDER BY ci.position, ci.item_id`,
      [access.transferId],
    );
    const incompleteRequired = result.rows.filter(
      (item) => item.is_required && !item.is_completed,
    ).length;
    return NextResponse.json({
      items: result.rows,
      summary: {
        total: result.rows.length,
        completed: result.rows.filter((item) => item.is_completed).length,
        incomplete_required: incompleteRequired,
        ready: incompleteRequired === 0,
      },
    });
  } catch (error) {
    console.error("Failed to retrieve transfer checklist", error);
    return NextResponse.json({ error: "Unable to retrieve transfer checklist" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: Context) {
  const access = await requireTransfer(request, (await context.params).transferid);
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 });
  }
  if (!isObject(body) || Array.isArray(body) || !Array.isArray(body.items))
    return NextResponse.json({ error: "items must be an array" }, { status: 422 });
  const rootUnknown = Object.keys(body).filter((key) => key !== "items");
  const errors = rootUnknown.map((key) => `Unknown field: ${key}`);
  const updates: { item_id: string; is_completed: boolean; notes: string | null }[] = [];
  body.items.forEach((raw, index) => {
    if (!isObject(raw) || Array.isArray(raw)) {
      errors.push(`items[${index}] must be an object`);
      return;
    }
    const itemId = typeof raw.item_id === "string" ? parseUuid(raw.item_id) : null;
    if (!itemId) errors.push(`items[${index}].item_id must be a valid UUID`);
    if (typeof raw.is_completed !== "boolean")
      errors.push(`items[${index}].is_completed must be boolean`);
    const notesErrors: string[] = [];
    const notes = validateText(raw.notes, `items[${index}].notes`, 5000, true, notesErrors);
    errors.push(...notesErrors);
    const unknown = Object.keys(raw).filter((key) => !["item_id", "is_completed", "notes"].includes(key));
    unknown.forEach((key) => errors.push(`items[${index}].${key} is unknown`));
    if (itemId && typeof raw.is_completed === "boolean" && !notesErrors.length)
      updates.push({ item_id: itemId, is_completed: raw.is_completed, notes: notes ?? null });
  });
  if (new Set(updates.map((item) => item.item_id)).size !== updates.length)
    errors.push("items cannot contain duplicate item_id values");
  if (errors.length)
    return NextResponse.json({ error: "Validation failed", details: errors }, { status: 422 });
  if (!["draft", "validated", "submitted"].includes(String(access.transfer.status)))
    return NextResponse.json({ error: "A finalized transfer checklist cannot be edited" }, { status: 409 });
  const teamRecipient = access.transfer.to_team_id
    ? await pool.query(
        "SELECT 1 FROM users WHERE user_id=$1 AND team_id=$2 AND is_active=TRUE AND deleted_at IS NULL",
        [access.context.userId, access.transfer.to_team_id],
      )
    : null;
  const actorAllowed =
    access.context.access.canViewAllProjects ||
    access.transfer.requested_by === access.context.userId ||
    access.transfer.to_owner_user_id === access.context.userId ||
    Boolean(teamRecipient?.rowCount);
  if (!actorAllowed)
    return NextResponse.json({ error: "You cannot edit this transfer checklist" }, { status: 403 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT item_id FROM transfer_checklist_items WHERE transfer_id=$1 FOR UPDATE",
      [access.transferId],
    );
    const existingIds = new Set(existing.rows.map((row) => row.item_id as string));
    if (updates.some((item) => !existingIds.has(item.item_id))) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "One or more checklist items do not belong to this transfer" }, { status: 422 });
    }
    for (const item of updates) {
      await client.query(
        `UPDATE transfer_checklist_items SET is_completed=$1, notes=$2,
         completed_by=CASE WHEN $1 THEN $3 ELSE NULL END,
         completed_at=CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
         updated_at=CURRENT_TIMESTAMP WHERE item_id=$4 AND transfer_id=$5`,
        [item.is_completed, item.notes, access.context.userId, item.item_id, access.transferId],
      );
    }
    if (access.transfer.status === "validated")
      await client.query(
        `UPDATE transfers SET status='draft', validated_at=NULL,
         validated_by=NULL, updated_at=CURRENT_TIMESTAMP WHERE transfer_id=$1`,
        [access.transferId],
      );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Transfer checklist updated" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to update transfer checklist", error);
    return NextResponse.json({ error: "Unable to update transfer checklist" }, { status: 500 });
  } finally {
    client.release();
  }
}
