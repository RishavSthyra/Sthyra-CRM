import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { validateQualificationFields } from "@/lib/projectLeadConfiguration";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

type Context = { params: Promise<{ projectid: string }> };
const COLUMNS = `field_id, project_id, field_key, field_label, field_type, is_required, options, position, is_active, created_at, updated_at`;

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
      `SELECT ${COLUMNS} FROM project_qualification_fields WHERE project_id=$1 AND is_active=TRUE ORDER BY position, field_id`,
      [projectId],
    );
    return NextResponse.json({ fields: result.rows });
  } catch (error) {
    console.error("Failed to retrieve qualification fields", error);
    return NextResponse.json(
      { error: "Unable to retrieve qualification fields" },
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
  const validation = validateQualificationFields(body);
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
      "UPDATE project_qualification_fields SET is_active=FALSE, updated_at=CURRENT_TIMESTAMP WHERE project_id=$1 AND is_active=TRUE",
      [projectId],
    );
    for (const field of validation.data) {
      await client.query(
        `INSERT INTO project_qualification_fields (project_id, field_key, field_label, field_type, is_required, options, position)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
         ON CONFLICT (project_id, field_key) DO UPDATE SET
           field_label=EXCLUDED.field_label, field_type=EXCLUDED.field_type,
           is_required=EXCLUDED.is_required, options=EXCLUDED.options,
           position=EXCLUDED.position, is_active=TRUE, updated_at=CURRENT_TIMESTAMP`,
        [
          projectId,
          field.field_key,
          field.field_label,
          field.field_type,
          field.is_required,
          JSON.stringify(field.options),
          field.position,
        ],
      );
    }
    const result = await client.query(
      `SELECT ${COLUMNS} FROM project_qualification_fields WHERE project_id=$1 AND is_active=TRUE ORDER BY position, field_id`,
      [projectId],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Qualification fields replaced",
      fields: result.rows,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to replace qualification fields", error);
    return NextResponse.json(
      { error: "Unable to replace qualification fields" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
