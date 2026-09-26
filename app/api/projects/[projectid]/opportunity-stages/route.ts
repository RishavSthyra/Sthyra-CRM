import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { validateOpportunityStages } from "@/lib/opportunityStages";
import { canAccessProject } from "@/lib/projectAccess";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

type Context = { params: Promise<{ projectid: string }> };

const COLUMNS = `stage_id, project_id, stage_key, stage_name, position,
  probability, color, is_initial, is_active, created_at, updated_at`;

export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const projectId = parsePositiveInteger((await context.params).projectid);
  if (!projectId)
    return NextResponse.json(
      { error: "projectId must be a positive integer" },
      { status: 400 },
    );
  if (!canAccessProject(scope.context.access, projectId))
    return NextResponse.json(
      { error: "You do not have access to this project" },
      { status: 403 },
    );

  try {
    const result = await pool.query(
      `SELECT ${COLUMNS}
       FROM project_opportunity_stages
       WHERE project_id=$1 AND is_active=TRUE
       ORDER BY position, stage_id`,
      [projectId],
    );
    return NextResponse.json({ stages: result.rows });
  } catch (error) {
    console.error("Failed to retrieve opportunity stages", error);
    return NextResponse.json(
      { error: "Unable to retrieve opportunity stages" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const projectId = parsePositiveInteger((await context.params).projectid);
  if (!projectId)
    return NextResponse.json(
      { error: "projectId must be a positive integer" },
      { status: 400 },
    );
  if (!canAccessProject(scope.context.access, projectId))
    return NextResponse.json(
      { error: "You do not have access to this project" },
      { status: 403 },
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const validation = validateOpportunityStages(body);
  if (!validation.ok)
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const project = await client.query(
      `SELECT project_id FROM projects
       WHERE project_id=$1 AND company_id=$2
       FOR UPDATE`,
      [projectId, scope.context.access.company.company_id],
    );
    if (!project.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const usedStages = await client.query(
      `SELECT DISTINCT stage_key FROM opportunities
       WHERE project_id=$1 AND status='open'`,
      [projectId],
    );
    const submitted = new Set(validation.data.map((stage) => stage.stage_key));
    const missingUsed = usedStages.rows
      .map((row) => String(row.stage_key))
      .filter((stageKey) => !submitted.has(stageKey));
    if (missingUsed.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "Stages used by open opportunities cannot be removed",
          details: missingUsed,
        },
        { status: 409 },
      );
    }

    await client.query(
      `UPDATE project_opportunity_stages
       SET is_active=FALSE, is_initial=FALSE, updated_at=CURRENT_TIMESTAMP
       WHERE project_id=$1 AND is_active=TRUE`,
      [projectId],
    );
    for (const stage of validation.data) {
      await client.query(
        `INSERT INTO project_opportunity_stages (
           project_id, stage_key, stage_name, position, probability, color,
           is_initial
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (project_id, stage_key) DO UPDATE SET
           stage_name=EXCLUDED.stage_name,
           position=EXCLUDED.position,
           probability=EXCLUDED.probability,
           color=EXCLUDED.color,
           is_initial=EXCLUDED.is_initial,
           is_active=TRUE,
           updated_at=CURRENT_TIMESTAMP`,
        [
          projectId,
          stage.stage_key,
          stage.stage_name,
          stage.position,
          stage.probability,
          stage.color,
          stage.is_initial,
        ],
      );
    }
    const result = await client.query(
      `SELECT ${COLUMNS}
       FROM project_opportunity_stages
       WHERE project_id=$1 AND is_active=TRUE
       ORDER BY position, stage_id`,
      [projectId],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Opportunity stages updated",
      stages: result.rows,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to replace opportunity stages", error);
    return NextResponse.json(
      { error: "Unable to replace opportunity stages" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
