import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireTransferTemplate } from "@/lib/transferTemplateAccess";

export async function setTransferTemplateActive(
  request: NextRequest,
  rawTemplateId: string,
  active: boolean,
) {
  const access = await requireTransferTemplate(request, rawTemplateId, true);
  if (!access.ok) return access.response;
  if (Boolean(access.template.is_active) === active)
    return NextResponse.json(
      { error: `Template is already ${active ? "active" : "inactive"}` },
      { status: 409 },
    );
  try {
    if (active) {
      const count = await pool.query(
        "SELECT COUNT(*)::integer AS total FROM transfer_checklist_template_items WHERE template_id=$1",
        [access.templateId],
      );
      if (Number(count.rows[0]?.total ?? 0) === 0)
        return NextResponse.json({ error: "Add at least one checklist item before activating this template" }, { status: 409 });
    } else {
      const activeTransfers = await pool.query(
        `SELECT 1 FROM transfers
         WHERE checklist_template_id=$1
           AND status IN ('draft','validated','submitted') LIMIT 1`,
        [access.templateId],
      );
      if (activeTransfers.rowCount)
        return NextResponse.json(
          { error: "This template is still used by an active transfer" },
          { status: 409 },
        );
    }
    const result = await pool.query(
      `UPDATE transfer_checklist_templates SET is_active=$1, updated_by=$2,
       updated_at=CURRENT_TIMESTAMP WHERE template_id=$3 RETURNING *`,
      [active, access.context.userId, access.templateId],
    );
    return NextResponse.json({
      message: `Transfer checklist template ${active ? "activated" : "deactivated"}`,
      template: result.rows[0],
    });
  } catch (error) {
    console.error(`Failed to ${active ? "activate" : "deactivate"} transfer checklist template`, error);
    return NextResponse.json({ error: `Unable to ${active ? "activate" : "deactivate"} template` }, { status: 500 });
  }
}
