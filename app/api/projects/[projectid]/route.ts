import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getProjectDatabaseErrorCode,
  PROJECT_COLUMNS,
  serializeProject,
  validateProjectPayload,
} from "@/lib/projects";

import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

type ProjectContext = {
  params: Promise<{ projectid: string }>;
};

export async function GET(_request: NextRequest, context: ProjectContext) {
  const { projectid } = await context.params;
  const projectId = parsePositiveInteger(projectid);

  if (projectId === null) {
    return NextResponse.json(
      { error: "projectid must be a positive integer" },
      { status: 400 },
    );
  }

  try {
    const result = await pool.query(
      `SELECT ${PROJECT_COLUMNS}
       FROM projects p
       JOIN companies c ON c.company_id = p.company_id
       JOIN regions r ON r.region_id = p.region_id
       WHERE p.project_id = $1`,
      [projectId],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({ project: serializeProject(result.rows[0]) }, {status : 200});

  } catch (error) {
    console.error("Failed to retrieve project", error);
    return NextResponse.json(
      { error: "Unable to retrieve project" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: ProjectContext) {
 
  const { projectid } = await context.params;
 
  const projectId = parsePositiveInteger(projectid);

  if (projectId === null) {
    return NextResponse.json(
      { error: "projectid must be a positive integer" },
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

  const validation = validateProjectPayload(body, { partial: true });
  
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const project = validation.data;
  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    const existingProject = await client.query(
      "SELECT project_id FROM projects WHERE project_id = $1 FOR UPDATE",
      [projectId],
    );

    if (existingProject.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const updates: { column: string; value: unknown }[] = [];

    if (project.company_code !== undefined) {

      const companyResult = await client.query(
        `SELECT company_id
         FROM companies
         WHERE UPPER(company_code) = UPPER($1)
           AND archived_at IS NULL`,
        [project.company_code],
      );

      if (companyResult.rowCount === 0) {

        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Company not found" }, { status: 404 });

      }

      updates.push({
        column: "company_id",
        value: companyResult.rows[0].company_id,
      });
    }

    if (project.region_code !== undefined) {

      const regionResult = await client.query(
        `SELECT region_id
         FROM regions
         WHERE UPPER(region_code) = UPPER($1)
           AND is_active = TRUE`,
        [project.region_code],
      );

      if (regionResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Active region not found" },
          { status: 404 },
        );
      }

      updates.push({
        column: "region_id",
        value: regionResult.rows[0].region_id,
      });
    }

    const mutableFields = [
      "project_code",
      "project_name",
      "project_status",
      "project_type",
      "project_acres",
      "start_date",
      "expected_completion_date",
      "address",
      "postal_code",
      "latitude",
      "longitude",
      "rera_number",
      "is_active", 
    ] as const;

    for (const field of mutableFields) {
      if (project[field] !== undefined) {
        updates.push({ column: field, value: project[field] });
      }
    }

    const values = updates.map((update) => update.value);

    const assignments = updates.map(
      (update, index) => `${update.column} = $${index + 1}`,
    );
    values.push(projectId);

    await client.query(
      `UPDATE projects
       SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
       WHERE project_id = $${values.length}`,
      values,
    );

    const result = await client.query(
      `SELECT ${PROJECT_COLUMNS}
       FROM projects p
       JOIN companies c ON c.company_id = p.company_id
       JOIN regions r ON r.region_id = p.region_id
       WHERE p.project_id = $1`,
      [projectId],
    );

    await client.query("COMMIT");

    return NextResponse.json({
      message: "Project updated",
      project: serializeProject(result.rows[0]),
    });
  } catch (error) {

    await client.query("ROLLBACK");

    const code = getProjectDatabaseErrorCode(error);

    if (code === "23505") {
      return NextResponse.json(
        { error: "This project_code already exists for the company" },
        { status: 409 },
      );
    }

    if (code === "23514") {
      return NextResponse.json(
        { error: "Project data violates a database constraint" },
        { status: 422 },
      );
    }

    console.error("Failed to update project", error);
    return NextResponse.json(
      { error: "Unable to update project" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
