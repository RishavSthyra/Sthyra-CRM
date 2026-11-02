import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission, roleHasPermission } from "@/lib/authorization";
import { getProjectStage, lockLead, transitionLead } from "@/lib/leadCommands";
import { evaluateManualLeadStageTransition } from "@/lib/manualLeadStageTransition";
import { parseLeadId } from "@/lib/leads";
import { canAccessOperationsEntity } from "@/lib/operationsAccess";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

type Context = { params: Promise<{ leadid: string }> };
export async function POST(request: NextRequest, context: Context) {
  const scope = await requirePermission(request, "LEADS_UPDATE");
  if (!scope.ok) return scope.response;
  const leadId = parseLeadId((await context.params).leadid);
  if (!leadId) {
    return NextResponse.json(
      { error: "leadId must be a valid UUID" },
      { status: 400 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  if (
    !isObject(body) ||
    typeof body.stage_key !== "string" ||
    !body.stage_key.trim()
  ) {
    return NextResponse.json(
      { error: "stage_key is required" },
      { status: 422 },
    );
  }
  const errors: string[] = [];
  const reason = validateText(body.reason, "reason", 5000, false, errors);
  if (!reason) errors.push("reason is required");
  Object.keys(body)
    .filter((key) => !["stage_key", "reason"].includes(key))
    .forEach((key) => errors.push(`Unknown field: ${key}`));
  if (errors.length) {
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lead = await lockLead(client, leadId);
    if (!lead) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    const project = await client.query(
      "SELECT company_id FROM projects WHERE project_id=$1",
      [lead.project_id],
    );
    if (
      !project.rowCount ||
      !canAccessOperationsEntity(
        scope.context.access,
        Number(project.rows[0].company_id),
        Number(lead.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this lead" },
        { status: 403 },
      );
    }
    if (
      ["qualified", "closed", "duplicate", "invalid"].includes(
        lead.status as string,
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            lead.status === "qualified"
              ? "Converted leads are managed through their opportunity"
              : `Cannot change stage while lead is ${lead.status}`,
        },
        { status: 409 },
      );
    }
    const stage = await getProjectStage(
      client,
      lead.project_id as number,
      body.stage_key,
    );
    if (!stage) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Active project stage not found" },
        { status: 422 },
      );
    }
    const currentStageResult = lead.stage_id
      ? await client.query(
          `SELECT stage_key, stage_name, position, is_terminal
           FROM project_lead_stages
           WHERE stage_id=$1 AND project_id=$2`,
          [lead.stage_id, lead.project_id],
        )
      : null;
    const transition = evaluateManualLeadStageTransition({
      currentStage: currentStageResult?.rows[0] ?? null,
      targetStage: {
        stage_key: String(stage.stage_key),
        stage_name: String(stage.stage_name),
        position: Number(stage.position),
        is_terminal: Boolean(stage.is_terminal),
      },
      canMoveBackward: roleHasPermission(
        scope.context.access.roleKey,
        scope.context.permissions,
        "PROJECTS_MANAGE",
      ),
    });
    if (!transition.ok) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: transition.error },
        { status: transition.status },
      );
    }
    const updated = await transitionLead(
      client,
      lead,
      "change_stage",
      lead.status as string,
      stage.stage_id as string,
      {},
      { stage_key: stage.stage_key, reason, direction: transition.direction },
      scope.context.userId,
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Lead stage changed", lead: updated });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to change lead stage", error);
    return NextResponse.json(
      { error: "Unable to change lead stage" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
