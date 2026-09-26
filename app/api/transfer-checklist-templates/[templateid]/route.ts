import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireTransferTemplate } from "@/lib/transferTemplateAccess";
import { validateTransferTemplate } from "@/lib/transfers";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";

type Context = { params: Promise<{ templateid: string }> };

export async function GET(request: NextRequest, context: Context) {
  const access = await requireTransferTemplate(request, (await context.params).templateid);
  if (!access.ok) return access.response;
  try {
    const items = await pool.query(
      `SELECT * FROM transfer_checklist_template_items
       WHERE template_id=$1 ORDER BY position, item_id`,
      [access.templateId],
    );
    return NextResponse.json({ template: { ...access.template, items: items.rows } });
  } catch (error) {
    console.error("Failed to retrieve transfer checklist template", error);
    return NextResponse.json({ error: "Unable to retrieve transfer checklist template" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const access = await requireTransferTemplate(request, (await context.params).templateid, true);
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 });
  }
  const validation = validateTransferTemplate(body, true);
  if (!validation.ok)
    return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  if (
    validation.data.project_id &&
    !access.context.access.projects.some((project) => project.project_id === validation.data.project_id)
  )
    return NextResponse.json({ error: "Invalid or inaccessible project_id" }, { status: 422 });
  const entries = Object.entries(validation.data).filter(([, value]) => value !== undefined);
  const values = entries.map(([, value]) => value);
  values.push(access.context.userId, access.templateId);
  const assignments = entries.map(([field], index) => `${field}=$${index + 1}`);
  try {
    const result = await pool.query(
      `UPDATE transfer_checklist_templates SET ${assignments.join(", ")},
       updated_by=$${values.length - 1}, updated_at=CURRENT_TIMESTAMP
       WHERE template_id=$${values.length} RETURNING *`,
      values,
    );
    return NextResponse.json({ message: "Transfer checklist template updated", template: result.rows[0] });
  } catch (error) {
    if (getDatabaseErrorCode(error) === "23505")
      return NextResponse.json({ error: "A template with this name already exists in this scope" }, { status: 409 });
    console.error("Failed to update transfer checklist template", error);
    return NextResponse.json({ error: "Unable to update transfer checklist template" }, { status: 500 });
  }
}
