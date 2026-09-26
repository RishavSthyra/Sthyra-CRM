import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getProjectStage,
  lockLead,
  transitionLead,
  validateQualificationValues,
} from "@/lib/leadCommands";
import { parseLeadId } from "@/lib/leads";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { isObject } from "@/utils/isObject";

type Context = { params: Promise<{ leadid: string }> };
export async function POST(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
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
    !isObject(body.qualification_data) ||
    Array.isArray(body.qualification_data)
  ) {
    return NextResponse.json(
      { error: "qualification_data must be a JSON object" },
      { status: 422 },
    );
  }
  if (
    body.stage_key !== undefined &&
    (typeof body.stage_key !== "string" || !body.stage_key.trim())
  ) {
    return NextResponse.json(
      { error: "stage_key must be a non-empty string" },
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
    if (!["active", "nurture"].includes(lead.status as string)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `Cannot qualify a ${lead.status} lead` },
        { status: 409 },
      );
    }
    const errors = await validateQualificationValues(
      client,
      lead.project_id as number,
      body.qualification_data,
    );
    if (errors.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Validation failed", details: errors },
        { status: 422 },
      );
    }
    let stageId = lead.stage_id as string | null;
    if (typeof body.stage_key === "string") {
      const stage = await getProjectStage(
        client,
        lead.project_id as number,
        body.stage_key,
      );
      if (!stage || stage.is_terminal) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Valid non-terminal project stage not found" },
          { status: 422 },
        );
      }
      stageId = stage.stage_id as string;
    }
    const updated = await transitionLead(
      client,
      lead,
      "qualify",
      "qualified",
      stageId,
      { qualification_data: body.qualification_data, qualified_at: new Date() },
      { qualification_data: body.qualification_data },
      scope.context.userId,
    );
    const opportunityResult = await client.query(
      `UPDATE opportunities
       SET created_by=COALESCE(created_by,$2), updated_by=COALESCE(updated_by,$2)
       WHERE lead_id=$1
       RETURNING *`,
      [leadId, scope.context.userId],
    );
    const opportunity = opportunityResult.rows[0];
    if (!opportunity) {
      throw new Error("Qualified lead did not create an opportunity");
    }
    await client.query(
      `INSERT INTO opportunity_state_history (
         opportunity_id, action, from_status, to_status, from_stage_key,
         to_stage_key, metadata, performed_by
       )
       SELECT $1, 'qualified_from_lead', NULL, 'open', NULL, 'qualified',
              JSONB_BUILD_OBJECT('lead_id',$2::uuid), $3
       WHERE NOT EXISTS (
         SELECT 1 FROM opportunity_state_history
         WHERE opportunity_id=$1 AND action='qualified_from_lead'
       )`,
      [opportunity.opportunity_id, leadId, scope.context.userId],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Lead qualified and opportunity created",
      lead: updated,
      opportunity,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to qualify lead", error);
    return NextResponse.json(
      { error: "Unable to qualify lead" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
