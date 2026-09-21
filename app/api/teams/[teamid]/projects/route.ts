import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseTeamId } from "@/lib/teams";

 type TeamProjectsContext = {
  params: Promise<{ teamid: string }>;
};

const PROJECT_COLUMNS = `
  p.project_id,
  p.company_id,
  p.project_code,
  p.project_name,
  p.project_status,
  p.project_type,
  p.project_acres,
  p.start_date::text AS start_date,
  p.expected_completion_date::text AS expected_completion_date,
  p.address,
  p.postal_code,
  p.latitude,
  p.longitude,
  p.rera_number,
  p.is_active,
  p.created_at,
  p.updated_at,
  tp.created_at AS assigned_at
`;

function validateProjectIds(body: unknown):
  | { ok: true; projectIds: number[] }
  | { ok: false; errors: string[] } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const errors = Object.keys(body)
    .filter((field) => field !== "project_ids")
    .map((field) => `Unknown field: ${field}`);
  const projectIds = (body as { project_ids?: unknown }).project_ids;

  if (!Array.isArray(projectIds)) {
    errors.push("project_ids must be an array");
    return { ok: false, errors };
  }

  const normalizedIds: number[] = [];
  const seen = new Set<number>();
  projectIds.forEach((projectId, index) => {
    if (
      typeof projectId !== "number" ||
      !Number.isSafeInteger(projectId) ||
      projectId <= 0
    ) {
      errors.push(`project_ids[${index}] must be a positive integer`);
      return;
    }
    if (seen.has(projectId)) {
      errors.push(`project_ids contains a duplicate project ID: ${projectId}`);
      return;
    }
    seen.add(projectId);
    normalizedIds.push(projectId);
  });

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, projectIds: normalizedIds };
}

async function getTeamProjectRows(queryable: {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}, teamId: string) {
  const result = await queryable.query(
    `SELECT ${PROJECT_COLUMNS}
     FROM team_projects tp
     JOIN projects p ON p.project_id = tp.project_id
     WHERE tp.team_id = $1
     ORDER BY p.project_name ASC, p.project_id ASC`,
    [teamId],
  );
  return result.rows;
}

export async function GET(
  _request: NextRequest,
  context: TeamProjectsContext,
) {
  const { teamid } = await context.params;
  const teamId = parseTeamId(teamid);
  if (teamId === null) {
    return NextResponse.json({ error: "teamid must be a valid UUID" }, { status: 400 });
  }

  try {
    const team = await pool.query("SELECT team_id FROM teams WHERE team_id = $1", [teamId]);
    if (team.rowCount === 0) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    return NextResponse.json({ projects: await getTeamProjectRows(pool, teamId) });
  } catch (error) {
    console.error("Failed to retrieve team projects", error);
    return NextResponse.json(
      { error: "Unable to retrieve team projects" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: TeamProjectsContext,
) {
  const { teamid } = await context.params;
  const teamId = parseTeamId(teamid);
  if (teamId === null) {
    return NextResponse.json({ error: "teamid must be a valid UUID" }, { status: 400 });
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

  const validation = validateProjectIds(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const team = await client.query(
      "SELECT team_id FROM teams WHERE team_id = $1 FOR UPDATE",
      [teamId],
    );
    if (team.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    if (validation.projectIds.length > 0) {
      const projects = await client.query(
        "SELECT project_id FROM projects WHERE project_id = ANY($1::integer[])",
        [validation.projectIds],
      );
      const existingIds = new Set(
        projects.rows.map((row: { project_id: number }) => Number(row.project_id)),
      );
      const missingIds = validation.projectIds.filter((projectId) => !existingIds.has(projectId));
      if (missingIds.length > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            error: "One or more projects were not found",
            details: { project_ids: missingIds },
          },
          { status: 422 },
        );
      }
    }

    await client.query("DELETE FROM team_projects WHERE team_id = $1", [teamId]);
    if (validation.projectIds.length > 0) {
      await client.query(
        `INSERT INTO team_projects (team_id, project_id)
         SELECT $1::uuid, ids.project_id
         FROM unnest($2::integer[]) AS ids(project_id)`,
        [teamId, validation.projectIds],
      );
    }

    const projects = await getTeamProjectRows(client, teamId);
    await client.query("COMMIT");
    return NextResponse.json({ message: "Team projects replaced", projects });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to replace team projects", error);
    return NextResponse.json(
      { error: "Unable to replace team projects" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
