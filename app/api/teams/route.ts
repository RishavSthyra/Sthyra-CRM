import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getTeamDatabaseErrorCode,
  serializeTeam,
  TEAM_COLUMNS,
  validateTeamPayload,
} from "@/lib/teams";

function parsePositiveInteger(value: string | null, fallback: number): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: NextRequest) {
  const page = parsePositiveInteger(request.nextUrl.searchParams.get("page"), 1);
  const limit = parsePositiveInteger(
    request.nextUrl.searchParams.get("limit"),
    50,
  );
  const includeInactiveValue = request.nextUrl.searchParams.get("includeInactive");

  if (page === null || limit === null || limit > 100) {
    return NextResponse.json(
      { error: "page and limit must be positive integers; limit cannot exceed 100" },
      { status: 400 },
    );
  }

  if (
    includeInactiveValue !== null &&
    includeInactiveValue !== "true" &&
    includeInactiveValue !== "false"
  ) {
    return NextResponse.json(
      { error: "includeInactive must be true or false" },
      { status: 400 },
    );
  }

  const filters: string[] = [];
  const values: unknown[] = [];
  if (includeInactiveValue !== "true") filters.push("is_active = TRUE");

  const search = request.nextUrl.searchParams.get("search")?.trim();
  if (search) {
    values.push(`%${search}%`);
    const parameter = `$${values.length}`;
    filters.push(`(name ILIKE ${parameter} OR team_type ILIKE ${parameter})`);
  }

  const companyIdValue = request.nextUrl.searchParams.get("companyId");
  if (companyIdValue !== null) {
    const companyId = parsePositiveInteger(companyIdValue, 0);
    if (companyId === null) {
      return NextResponse.json(
        { error: "companyId must be a positive integer" },
        { status: 400 },
      );
    }
    values.push(companyId);
    filters.push(`company_id = $${values.length}`);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * limit;

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM teams ${whereClause}`,
      values,
    );
    const listValues = [...values, limit, offset];
    const result = await pool.query(
      `SELECT ${TEAM_COLUMNS}
       FROM teams
       ${whereClause}
       ORDER BY name ASC, team_id ASC
       LIMIT $${listValues.length - 1}
       OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    return NextResponse.json({
      teams: result.rows.map(serializeTeam),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("Failed to list teams", error);
    return NextResponse.json(
      { error: "Unable to retrieve teams" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }

  const validation = validateTeamPayload(body, { partial: false });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const team = validation.data;
  try {
    const result = await pool.query(
      `INSERT INTO teams (company_id, name, team_type, description)
       VALUES ($1, $2, $3, $4)
       RETURNING ${TEAM_COLUMNS}`,
      [team.company_id, team.name, team.team_type, team.description ?? null],
    );

    return NextResponse.json(
      { message: "Team created", team: serializeTeam(result.rows[0]) },
      { status: 201 },
    );
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

    console.error("Failed to create team", error);
    return NextResponse.json({ error: "Unable to create team" }, { status: 500 });
  }
}
