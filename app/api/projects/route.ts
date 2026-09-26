import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { DEFAULT_PROJECT_LEAD_STAGES } from "@/lib/defaultLeadStages";
import { DEFAULT_PROJECT_OPPORTUNITY_STAGES } from "@/lib/defaultOpportunityStages";
import {
  getProjectDatabaseErrorCode,
  isProjectStatus,
  isProjectType,
  PROJECT_COLUMNS,
  serializeProject,
  validateProjectPayload,
} from "@/lib/projects";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

export async function GET(request: NextRequest) {
  const parameters = request.nextUrl.searchParams;
  const page = parsePositiveInteger(parameters.get("page"), 1);
  const limit = parsePositiveInteger(parameters.get("limit"), 50);
  const includeInactiveValue = parameters.get("includeInactive");
  const status = parameters.get("status")?.trim().toLowerCase() ?? "";
  const type = parameters.get("type")?.trim().toLowerCase() ?? "";

  if (page === null || limit === null || limit > 100) {
    return NextResponse.json(
      {
        error:
          "page and limit must be positive integers; limit cannot exceed 100",
      },
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

  if (status && !isProjectStatus(status)) {
    return NextResponse.json(
      { error: "Invalid project status" },
      { status: 400 },
    );
  }

  if (type && !isProjectType(type)) {
    return NextResponse.json(
      { error: "Invalid project type" },
      { status: 400 },
    );
  }

  const filters: string[] = [];
  const values: unknown[] = [];

  const addFilter = (clause: string, value: unknown) => {
    values.push(value);
    filters.push(clause.replace("?", `$${values.length}`));
  };

  if (includeInactiveValue !== "true") filters.push("p.is_active = TRUE");

  const search = parameters.get("search")?.trim();
  if (search) {
    values.push(`%${search}%`);
    const placeholder = `$${values.length}`;
    filters.push(
      `(p.project_code ILIKE ${placeholder} OR p.project_name ILIKE ${placeholder} OR p.address ILIKE ${placeholder} OR p.rera_number ILIKE ${placeholder})`,
    );
  }

  const companyCode = parameters.get("companyCode")?.trim();
  if (companyCode) addFilter("UPPER(c.company_code) = UPPER(?)", companyCode);

  const regionCode = parameters.get("regionCode")?.trim();
  if (regionCode) addFilter("UPPER(r.region_code) = UPPER(?)", regionCode);

  if (status) addFilter("p.project_status = ?", status);
  if (type) addFilter("p.project_type = ?", type);

  const whereClause =
    filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * limit;

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::integer AS total
       FROM projects p
       JOIN companies c ON c.company_id = p.company_id
       JOIN regions r ON r.region_id = p.region_id
       ${whereClause}`,
      values,
    );

    const listValues = [...values, limit, offset];
    const result = await pool.query(
      `SELECT ${PROJECT_COLUMNS}
       FROM projects p
       JOIN companies c ON c.company_id = p.company_id
       JOIN regions r ON r.region_id = p.region_id
       ${whereClause}
       ORDER BY p.project_name ASC, p.project_id ASC
       LIMIT $${listValues.length - 1}
       OFFSET $${listValues.length}`,
      listValues,
    );

    const total = Number(countResult.rows[0]?.total ?? 0);

    return NextResponse.json({
      projects: result.rows.map(serializeProject),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Failed to list projects", error);
    return NextResponse.json(
      { error: "Unable to retrieve projects" },
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

  const validation = validateProjectPayload(body, { partial: false });
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

    const insertResult = await client.query(
      `INSERT INTO projects (
        company_id,
        region_id,
        project_code,
        project_name,
        project_status,
        project_type,
        project_acres,
        start_date,
        expected_completion_date,
        address,
        postal_code,
        latitude,
        longitude,
        rera_number,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING project_id`,
      [
        companyResult.rows[0].company_id,
        regionResult.rows[0].region_id,
        project.project_code,
        project.project_name,
        project.project_status,
        project.project_type,
        project.project_acres ?? null,
        project.start_date ?? null,
        project.expected_completion_date ?? null,
        project.address ?? null,
        project.postal_code ?? null,
        project.latitude ?? null,
        project.longitude ?? null,
        project.rera_number ?? null,
        project.is_active,
      ],
    );

    const projectId = insertResult.rows[0].project_id as number;
    for (const [index, stage] of DEFAULT_PROJECT_LEAD_STAGES.entries()) {
      await client.query(
        `INSERT INTO project_lead_stages (
          project_id, stage_key, stage_name, position, is_initial, is_terminal
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          projectId,
          stage.stage_key,
          stage.stage_name,
          index + 1,
          stage.is_initial,
          stage.is_terminal,
        ],
      );
    }
    for (const [index, stage] of DEFAULT_PROJECT_OPPORTUNITY_STAGES.entries()) {
      await client.query(
        `INSERT INTO project_opportunity_stages (
          project_id, stage_key, stage_name, position, probability, color,
          is_initial
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          projectId,
          stage.stage_key,
          stage.stage_name,
          index + 1,
          stage.probability,
          stage.color,
          stage.is_initial,
        ],
      );
    }

    const result = await client.query(
      `SELECT ${PROJECT_COLUMNS}
       FROM projects p
       JOIN companies c ON c.company_id = p.company_id
       JOIN regions r ON r.region_id = p.region_id
       WHERE p.project_id = $1`,
      [projectId],
    );

    await client.query("COMMIT");

    return NextResponse.json(
      { message: "Project created", project: serializeProject(result.rows[0]) },
      { status: 201 },
    );
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

    console.error("Failed to create project", error);
    return NextResponse.json(
      { error: "Unable to create project" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
