import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";
import {
  getTeamDatabaseErrorCode,
  serializeTeam,
  TEAM_COLUMNS,
  validateTeamPayload,
} from "@/lib/teams";
import { requirePermission } from "@/lib/authorization";
import { requireProjectAccessManager } from "@/lib/projectAccessAdministration";
import { validateProjectIds } from "@/lib/userRelations";
import { isObject } from "@/utils/isObject";

export async function GET(request: NextRequest) {
  const scope = await requirePermission(request, "PEOPLE_MANAGE");
  if (!scope.ok) return scope.response;

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
    const companyId = parsePositiveInteger(companyIdValue);
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
  const scope = await requirePermission(request, "PEOPLE_MANAGE");
  if (!scope.ok) return scope.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }

  const hasProjectSelection = isObject(body) && "project_ids" in body;
  const projectValidation = validateProjectIds({
    project_ids:
      isObject(body) && Array.isArray(body.project_ids) ? body.project_ids : [],
  });
  if (hasProjectSelection) {
    const projectScope = await requireProjectAccessManager(request);
    if (!projectScope.ok) return projectScope.response;
  }
  if (!projectValidation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: projectValidation.errors },
      { status: 422 },
    );
  }
  const teamBody = isObject(body)
    ? Object.fromEntries(
        Object.entries(body).filter(([key]) => key !== "project_ids"),
      )
    : body;
  const validation = validateTeamPayload(teamBody, { partial: false });

  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const team = validation.data;
  
  const companyId = scope.context.access.company.company_id;
  if (team.company_id !== companyId) {
    return NextResponse.json(
      { error: "Teams can only be created in your current company" },
      { status: 403 },
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (projectValidation.projectIds.length) {
      const projects = await client.query(
        `SELECT project_id FROM projects
         WHERE project_id = ANY($1::integer[]) AND company_id=$2 AND is_active=TRUE`,
        [projectValidation.projectIds, companyId],
      );
      if (projects.rowCount !== projectValidation.projectIds.length) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "One or more selected projects are unavailable" },
          { status: 422 },
        );
      }
    }
    const result = await client.query(
      `INSERT INTO teams (company_id, name, team_type, description)
       VALUES ($1, $2, $3, $4)
       RETURNING ${TEAM_COLUMNS}`,
      [team.company_id, team.name, team.team_type, team.description ?? null],
    );
    if (projectValidation.projectIds.length) {
      await client.query(
        `INSERT INTO team_projects (team_id, project_id)
         SELECT $1::uuid, project_id
         FROM unnest($2::integer[]) AS selected(project_id)`,
        [result.rows[0].team_id, projectValidation.projectIds],
      );
    }
    await client.query("COMMIT");

    return NextResponse.json(
      { message: "Team created", team: serializeTeam(result.rows[0]) },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
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
  } finally {
    client.release();
  }
}
