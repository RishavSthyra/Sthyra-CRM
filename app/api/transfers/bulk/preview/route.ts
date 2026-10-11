import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { validateBulkTransferPayload } from "@/lib/bulkTransfers";
import { prepareBulkTransfer } from "@/lib/bulkTransferService";
import { requireLeadVisibility } from "@/lib/leadVisibility";
import { canAccessProject } from "@/lib/projectAccess";

export async function POST(request: NextRequest) {
  const scope = await requireLeadVisibility(request, "LEADS_ASSIGN");
  if (!scope.ok) return scope.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const validation = validateBulkTransferPayload(body);
  if (!validation.ok)
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  if (!canAccessProject(scope.context.access, validation.data.project_id))
    return NextResponse.json(
      { error: "Invalid or inaccessible project_id" },
      { status: 400 },
    );

  try {
    const preview = await prepareBulkTransfer(
      pool,
      validation.data,
      scope.context.leadVisibility,
      false,
    );
    if (preview.referenceErrors.length)
      return NextResponse.json(
        { error: "Validation failed", details: preview.referenceErrors },
        { status: 422 },
      );
    return NextResponse.json({
      eligible: preview.eligible,
      blocked: preview.blocked,
      checklist_template_id: preview.templateId,
      checklist_items: preview.checklistItems,
      summary: {
        requested: validation.data.lead_ids.length,
        eligible: preview.eligible.length,
        blocked: preview.blocked.length,
      },
    });
  } catch (error) {
    console.error("Failed to preview bulk transfer", error);
    return NextResponse.json(
      { error: "Unable to preview bulk transfer" },
      { status: 500 },
    );
  }
}
