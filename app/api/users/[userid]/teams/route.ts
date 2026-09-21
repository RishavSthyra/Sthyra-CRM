import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseUserId } from "@/lib/users";
import { validateSingleUuidField } from "@/lib/userRelations";

type UserContext = {
  params: Promise<{ userid: string }>;
};

const TEAM_COLUMNS = `
  t.team_id,
  t.company_id,
  t.name,
  t.team_type,
  t.description,
  t.is_active,
  t.created_at,
  t.updated_at
`;

export async function GET(_request: NextRequest, context: UserContext) {
  const { userid } = await context.params;
  const userId = parseUserId(userid);
  if (userId === null) {
    return NextResponse.json({ error: "userid must be a valid UUID" }, { status: 400 });
  }

  try {
    const userResult = await pool.query(
      "SELECT team_id FROM users WHERE user_id = $1 AND deleted_at IS NULL",
      [userId],
    );
    if (userResult.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (userResult.rows[0].team_id === null) {
      return NextResponse.json({ teams: [] });
    }

    const result = await pool.query(
      `SELECT ${TEAM_COLUMNS} FROM teams t WHERE t.team_id = $1`,
      [userResult.rows[0].team_id],
    );
    return NextResponse.json({ teams: result.rows });
  } catch (error) {
    console.error("Failed to retrieve user team", error);
    return NextResponse.json({ error: "Unable to retrieve user team" }, { status: 500 });
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

  const validation = validateSingleUuidField(body, "team_id", { nullable: true });
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

    let teams: Record<string, unknown>[] = [];
    if (validation.value !== null) {
      const teamResult = await client.query(
        `SELECT ${TEAM_COLUMNS} FROM teams t WHERE t.team_id = $1`,
        [validation.value],
      );
      if (teamResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Team not found" }, { status: 404 });
      }
      teams = teamResult.rows;
    }

    await client.query(
      "UPDATE users SET team_id = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2",
      [validation.value, userId],
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "User team replaced", teams });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to replace user team", error);
    return NextResponse.json({ error: "Unable to replace user team" }, { status: 500 });
  } finally {
    client.release();
  }
}
