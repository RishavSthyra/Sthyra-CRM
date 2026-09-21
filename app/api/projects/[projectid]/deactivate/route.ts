import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  PROJECT_COLUMNS,
  serializeProject,
} from "@/lib/projects";

import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

type ProjectContext = {
  params: Promise<{ projectid: string }>;
};

export async function POST(_request: NextRequest, context: ProjectContext) {
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
      `WITH updated_project AS (
         UPDATE projects
         SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
         WHERE project_id = $1
         RETURNING *
       )
       SELECT ${PROJECT_COLUMNS}
       FROM updated_project p
       JOIN companies c ON c.company_id = p.company_id
       JOIN regions r ON r.region_id = p.region_id`,
      [projectId],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({
      message: "Project deactivated",
      project: serializeProject(result.rows[0]),
    });
  } catch (error) {
    console.error("Failed to deactivate project", error);
    return NextResponse.json(
      { error: "Unable to deactivate project" },
      { status: 500 },
    );
  }
}
