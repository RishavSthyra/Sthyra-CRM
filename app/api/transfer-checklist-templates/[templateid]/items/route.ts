import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireTransferTemplate } from "@/lib/transferTemplateAccess";
import { validateTemplateItems } from "@/lib/transfers";

type Context = { params: Promise<{ templateid: string }> };

export async function GET(request: NextRequest, context: Context) {
  const access = await requireTransferTemplate(request, (await context.params).templateid);
  if (!access.ok) return access.response;
  try {
    const result = await pool.query(
      `SELECT * FROM transfer_checklist_template_items
       WHERE template_id=$1 ORDER BY position, item_id`,
      [access.templateId],
    );
    return NextResponse.json({ items: result.rows });
  } catch (error) {
    console.error("Failed to retrieve transfer checklist template items", error);
    return NextResponse.json({ error: "Unable to retrieve template items" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: Context) {
  const access = await requireTransferTemplate(request, (await context.params).templateid, true);
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 });
  }
  const validation = validateTemplateItems(body);
  if (!validation.ok)
    return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const activeTransfers = await client.query(
      `SELECT 1 FROM transfers
       WHERE checklist_template_id=$1 AND status IN ('draft','validated','submitted') LIMIT 1`,
      [access.templateId],
    );
    if (activeTransfers.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Template items cannot be replaced while an active transfer uses this template" },
        { status: 409 },
      );
    }
    await client.query("DELETE FROM transfer_checklist_template_items WHERE template_id=$1", [access.templateId]);
    for (const item of validation.data) {
      await client.query(
        `INSERT INTO transfer_checklist_template_items (
           template_id, label, description, position, is_required
         ) VALUES ($1,$2,$3,$4,$5)`,
        [access.templateId, item.label, item.description, item.position, item.is_required],
      );
    }
    await client.query(
      `UPDATE transfer_checklist_templates SET updated_by=$1,
       updated_at=CURRENT_TIMESTAMP WHERE template_id=$2`,
      [access.context.userId, access.templateId],
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Transfer checklist template items replaced", items: validation.data });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to replace transfer checklist template items", error);
    return NextResponse.json({ error: "Unable to replace template items" }, { status: 500 });
  } finally {
    client.release();
  }
}

