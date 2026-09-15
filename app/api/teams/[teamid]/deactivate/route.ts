import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseTeamId, serializeTeam, TEAM_COLUMNS } from "@/lib/teams";

type TeamContext = {
  params: Promise<{ teamid: string }>;
};

export async function POST(_request: Request, context: TeamContext) {
  const { teamid } = await context.params;
  const teamId = parseTeamId(teamid);
  if (teamId === null) {
    return NextResponse.json({ error: "teamid must be a valid UUID" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `UPDATE teams
       SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE team_id = $1
       RETURNING ${TEAM_COLUMNS}`,
      [teamId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    return NextResponse.json({
      message: "Team deactivated",
      team: serializeTeam(result.rows[0]),
    });
  } catch (error) {
    console.error("Failed to deactivate team", error);
    return NextResponse.json({ error: "Unable to deactivate team" }, { status: 500 });
  }
}
