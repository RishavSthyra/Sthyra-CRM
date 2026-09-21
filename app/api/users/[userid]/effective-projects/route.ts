import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { PROJECT_COLUMNS, serializeProject } from "@/lib/projects";
import { parseUserId } from "@/lib/users";

type UserContext = {
  params: Promise<{ userid: string }>;
};

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

    const result = await pool.query(
      `SELECT ${PROJECT_COLUMNS}
       FROM projects p
       JOIN companies c ON c.company_id = p.company_id
       JOIN regions r ON r.region_id = p.region_id
       WHERE p.is_active = TRUE
         AND p.project_id IN (
           SELECT up.project_id
           FROM users u
           JOIN user_projects up ON up.user_id = u.user_id
           WHERE u.user_id = $1
             AND u.deleted_at IS NULL
             AND u.is_active = TRUE
           UNION
           SELECT tp.project_id
           FROM users u
           JOIN teams t ON t.team_id = u.team_id
           JOIN team_projects tp ON tp.team_id = t.team_id
           WHERE u.user_id = $1
             AND u.deleted_at IS NULL
             AND u.is_active = TRUE
             AND t.is_active = TRUE
         )
       ORDER BY p.project_name ASC, p.project_id ASC`,
      [userId],
    );
    return NextResponse.json({ projects: result.rows.map(serializeProject) });
  } catch (error) {
    console.error("Failed to retrieve effective projects", error);
    return NextResponse.json(
      { error: "Unable to retrieve effective projects" },
      { status: 500 },
    );
  }
}
