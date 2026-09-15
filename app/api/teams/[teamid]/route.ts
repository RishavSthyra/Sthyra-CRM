import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getTeamDatabaseErrorCode,
  parseTeamId,
  serializeTeam,
  TEAM_COLUMNS,
  TeamField,
  validateTeamPayload,
} from "@/lib/teams";

type TeamContext = {
  params: Promise<{ teamid: string }>;
};

export async function GET(_request: NextRequest, context: TeamContext) {
  const { teamid } = await context.params;
  const teamId = parseTeamId(teamid);
  if (teamId === null) {
    return NextResponse.json({ error: "teamid must be a valid UUID" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `SELECT ${TEAM_COLUMNS} FROM teams WHERE team_id = $1`,
      [teamId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    return NextResponse.json({ team: serializeTeam(result.rows[0]) });
  } catch (error) {
    console.error("Failed to retrieve team", error);
    return NextResponse.json({ error: "Unable to retrieve team" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: TeamContext) {
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

  const validation = validateTeamPayload(body, { partial: true });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const mutableFields: TeamField[] = ["company_id", "name", "team_type", "description"];
  const updates = mutableFields
    .filter((field) => validation.data[field] !== undefined)
    .map((field) => ({ field, value: validation.data[field] }));
  const values: unknown[] = updates.map(({ value }) => value);
  const assignments = updates.map(
    ({ field }, index) => `${field} = $${index + 1}`,
  );
  values.push(teamId);

  try {
    const result = await pool.query(
      `UPDATE teams
       SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
       WHERE team_id = $${values.length}
       RETURNING ${TEAM_COLUMNS}`,
      values,
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    return NextResponse.json({
      message: "Team updated",
      team: serializeTeam(result.rows[0]),
    });
  } catch (error) {
    const code = getTeamDatabaseErrorCode(error);
    if (code === "23503") {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    if (code === "23505") {
      return NextResponse.json(
        { error: "A team with these values already exists" },
        { status: 409 },
      );
    }
    console.error("Failed to update team", error);
    return NextResponse.json({ error: "Unable to update team" }, { status: 500 });
  }
}
