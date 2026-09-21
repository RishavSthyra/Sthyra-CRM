import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { validateClosingReasons } from "@/lib/projectLeadConfiguration";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

type Context = { params: Promise<{ projectid: string }> };
const COLUMNS = `reason_id, project_id, reason_key, reason_name, outcome, position, is_active, created_at, updated_at`;

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
      `SELECT ${COLUMNS} FROM project_closing_reasons WHERE project_id=$1 AND is_active=TRUE ORDER BY position, reason_id`,
      [projectId],
    );
    return NextResponse.json({ reasons: result.rows });
  } catch (error) {
    console.error("Failed to retrieve closing reasons", error);
    return NextResponse.json(
      { error: "Unable to retrieve closing reasons" },
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
  const validation = validateClosingReasons(body);
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
      "UPDATE project_closing_reasons SET is_active=FALSE, updated_at=CURRENT_TIMESTAMP WHERE project_id=$1 AND is_active=TRUE",
      [projectId],
    );
    for (const reason of validation.data) {
      await client.query(
        `INSERT INTO project_closing_reasons (project_id, reason_key, reason_name, outcome, position)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (project_id, reason_key) DO UPDATE SET
           reason_name=EXCLUDED.reason_name, outcome=EXCLUDED.outcome,
           position=EXCLUDED.position, is_active=TRUE, updated_at=CURRENT_TIMESTAMP`,
        [
          projectId,
          reason.reason_key,
          reason.reason_name,
          reason.outcome,
          reason.position,
        ],
      );
    }
    const result = await client.query(
      `SELECT ${COLUMNS} FROM project_closing_reasons WHERE project_id=$1 AND is_active=TRUE ORDER BY position, reason_id`,
      [projectId],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Closing reasons replaced",
      reasons: result.rows,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to replace closing reasons", error);
    return NextResponse.json(
      { error: "Unable to replace closing reasons" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
