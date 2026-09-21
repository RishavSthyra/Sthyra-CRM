import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { PROJECT_COLUMNS, serializeProject } from "@/lib/projects";
import { validateProjectIds } from "@/lib/userRelations";
import { parseUserId } from "@/lib/users";

type UserContext = {
  params: Promise<{ userid: string }>;
};

async function getDirectProjects(
  queryable: {
    query: (
      text: string,
      values?: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[] }>;
  },
  userId: string,
) {
  const result = await queryable.query(
    `SELECT ${PROJECT_COLUMNS}, up.created_at AS assigned_at
     FROM user_projects up
     JOIN projects p ON p.project_id = up.project_id
     JOIN companies c ON c.company_id = p.company_id
     JOIN regions r ON r.region_id = p.region_id
     WHERE up.user_id = $1
     ORDER BY p.project_name ASC, p.project_id ASC`,
    [userId],
  );
  return result.rows.map(serializeProject);
}

export async function GET(_request: NextRequest, context: UserContext) {
  const { userid } = await context.params;
  const userId = parseUserId(userid);
  if (userId === null) {
    return NextResponse.json({ error: "userid must be a valid UUID" }, { status: 400 });
  }

  try {
    const userResult = await pool.query(
      "SELECT user_id FROM users WHERE user_id = $1 AND deleted_at IS NULL",
      [userId],
    );
    if (userResult.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ projects: await getDirectProjects(pool, userId) });
  } catch (error) {
    console.error("Failed to retrieve user projects", error);
    return NextResponse.json(
      { error: "Unable to retrieve user projects" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, context: UserContext) {
  const { userid } = await context.params;
  const userId = parseUserId(userid);
  if (userId === null) {
    return NextResponse.json({ error: "userid must be a valid UUID" }, { status: 400 });
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
    const userResult = await client.query(
      "SELECT user_id FROM users WHERE user_id = $1 AND deleted_at IS NULL FOR UPDATE",
      [userId],
    );
    if (userResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (validation.projectIds.length > 0) {
      const projectResult = await client.query(
        "SELECT project_id FROM projects WHERE project_id = ANY($1::integer[])",
        [validation.projectIds],
      );
      const existingIds = new Set(
        projectResult.rows.map((row: { project_id: number }) => Number(row.project_id)),
      );
      const missingIds = validation.projectIds.filter(
        (projectId) => !existingIds.has(projectId),
      );
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

    await client.query("DELETE FROM user_projects WHERE user_id = $1", [userId]);
    if (validation.projectIds.length > 0) {
      await client.query(
        `INSERT INTO user_projects (user_id, project_id)
         SELECT $1::uuid, ids.project_id
         FROM unnest($2::integer[]) AS ids(project_id)`,
        [userId, validation.projectIds],
      );
    }

    const projects = await getDirectProjects(client, userId);
    await client.query("COMMIT");
    return NextResponse.json({ message: "User projects replaced", projects });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to replace user projects", error);
    return NextResponse.json(
      { error: "Unable to replace user projects" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
