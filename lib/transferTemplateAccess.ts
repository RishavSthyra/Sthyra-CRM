import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseUuid } from "@/lib/operations";
import { requireOperationsContext } from "@/lib/operationsAccess";

export async function requireTransferTemplate(
  request: NextRequest,
  rawTemplateId: string,
  admin = false,
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope;
  if (admin && !scope.context.access.canViewAllProjects)
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Administrator access is required" },
        { status: 403 },
      ),
    };
  const templateId = parseUuid(rawTemplateId);
  if (!templateId)
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "templateId must be a valid UUID" },
        { status: 400 },
      ),
    };
  try {
    const result = await pool.query(
      "SELECT * FROM transfer_checklist_templates WHERE template_id=$1",
      [templateId],
    );
    if (!result.rowCount)
      return {
        ok: false as const,
        response: NextResponse.json(
          { error: "Transfer checklist template not found" },
          { status: 404 },
        ),
      };
    const template = result.rows[0];
    if (Number(template.company_id) !== scope.context.access.company.company_id)
      return {
        ok: false as const,
        response: NextResponse.json(
          { error: "You do not have access to this template" },
          { status: 403 },
        ),
      };
    if (
      template.project_id !== null &&
      !scope.context.access.projects.some(
        (project) => project.project_id === Number(template.project_id),
      )
    )
      return {
        ok: false as const,
        response: NextResponse.json(
          { error: "You do not have access to this template" },
          { status: 403 },
        ),
      };
    return {
      ok: true as const,
      context: scope.context,
      templateId,
      template,
    };
  } catch (error) {
    console.error("Failed to resolve transfer template access", error);
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Unable to retrieve transfer checklist template" },
        { status: 500 },
      ),
    };
  }
}

