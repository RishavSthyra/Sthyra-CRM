import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { validateStages } from "@/lib/projectLeadConfiguration";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

type Context = { params: Promise<{ projectid: string }> };
const COLUMNS = `stage_id, project_id, stage_key, stage_name, position, is_initial, is_terminal, is_active, created_at, updated_at`;

export async function GET(_request: NextRequest, context: Context) {
  const projectId = parsePositiveInteger((await context.params).projectid);
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId must be a positive integer" },
      { status: 400 },
    );
  }
  try {
    const project = await pool.query(
      "SELECT project_id FROM projects WHERE project_id=$1",
      [projectId],
    );
    if (!project.rowCount) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM project_lead_stages WHERE project_id=$1 AND is_active=TRUE ORDER BY position, stage_id`,
      [projectId],
    );
    return NextResponse.json({ stages: result.rows });
  } catch (error) {
    console.error("Failed to retrieve lead stages", error);
    return NextResponse.json(
      { error: "Unable to retrieve lead stages" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, context: Context) {
  const projectId = parsePositiveInteger((await context.params).projectid);
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId must be a positive integer" },
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
  const validation = validateStages(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const project = await client.query(
      "SELECT project_id FROM projects WHERE project_id=$1 FOR UPDATE",
      [projectId],
    );
    if (!project.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    await client.query(
      "UPDATE project_lead_stages SET is_active=FALSE, updated_at=CURRENT_TIMESTAMP WHERE project_id=$1 AND is_active=TRUE",
      [projectId],
    );
    for (const stage of validation.data) {
      await client.query(
        `INSERT INTO project_lead_stages (project_id, stage_key, stage_name, position, is_initial, is_terminal)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (project_id, stage_key) DO UPDATE SET
           stage_name=EXCLUDED.stage_name, position=EXCLUDED.position,
           is_initial=EXCLUDED.is_initial, is_terminal=EXCLUDED.is_terminal,
           is_active=TRUE, updated_at=CURRENT_TIMESTAMP`,
        [
          projectId,
          stage.stage_key,
          stage.stage_name,
          stage.position,
          stage.is_initial,
          stage.is_terminal,
        ],
      );
    }
    const result = await client.query(
      `SELECT ${COLUMNS} FROM project_lead_stages WHERE project_id=$1 AND is_active=TRUE ORDER BY position, stage_id`,
      [projectId],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Lead stages replaced",
      stages: result.rows,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to replace lead stages", error);
    return NextResponse.json(
      { error: "Unable to replace lead stages" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
