import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import {
  createLead,
  LeadReferenceError,
  validateLeadPayload,
} from "@/lib/leads";
import { isUuid } from "@/lib/permissions";
import {
  canAccessProject,
  getAccessibleProjectIds,
  getUserProjectAccess,
} from "@/lib/projectAccess";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const authentication = await authenticateRequest(request);
  if (!authentication.ok) return authentication.response;

  let projectAccess;
  try {
    projectAccess = await getUserProjectAccess(
      authentication.auth.user.user_id,
    );
  } catch (error) {
    console.error("Failed to resolve lead project access", error);
    return NextResponse.json(
      { error: "Unable to resolve project access" },
      { status: 500 },
    );
  }
  if (!projectAccess) {
    return NextResponse.json(
      { error: "Your account is not connected to an active company" },
      { status: 403 },
    );
  }

  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  const values: unknown[] = [];
  const filters = ["1=1"];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue !== null && projectValue !== "all") {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId) {
      return NextResponse.json(
        { error: "project_id must be a positive integer" },
        { status: 400 },
      );
    }
    if (!canAccessProject(projectAccess, projectId)) {
      return NextResponse.json(
        { error: "You do not have access to this project" },
        { status: 403 },
      );
    }
    values.push(projectId);
    filters.push(`l.project_id=$${values.length}`);
  } else {
    const projectIds = getAccessibleProjectIds(projectAccess);
    if (projectIds.length === 0) {
      filters.push("FALSE");
    } else {
      values.push(projectIds);
      filters.push(`l.project_id=ANY($${values.length}::integer[])`);
    }
  }
  const statuses = [
    "active",
    "qualified",
    "closed",
    "nurture",
    "duplicate",
    "invalid",
  ];
  const status = request.nextUrl.searchParams.get("status");
  if (status) {
    if (!statuses.includes(status)) {
      return NextResponse.json(
        { error: "Invalid lead status" },
        { status: 400 },
      );
    }
    values.push(status);
    filters.push(`l.status=$${values.length}`);
  }
  const stageKey = request.nextUrl.searchParams.get("stage_key");
  if (stageKey) {
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(stageKey)) {
      return NextResponse.json(
        {
          error:
            "stage_key must use lowercase letters, numbers, and underscores",
        },
        { status: 400 },
      );
    }
    values.push(stageKey);
    filters.push(
      `EXISTS (
        SELECT 1 FROM project_lead_stages stage_filter
        WHERE stage_filter.stage_id=l.stage_id
          AND stage_filter.stage_key=$${values.length}
      )`,
    );
  }
  const temperature = request.nextUrl.searchParams.get("temperature");
  if (temperature) {
    if (!["cold", "warm", "hot"].includes(temperature)) {
      return NextResponse.json(
        { error: "Invalid lead temperature" },
        { status: 400 },
      );
    }
    values.push(temperature);
    filters.push(`l.temperature=$${values.length}`);
  }
  const assignment = request.nextUrl.searchParams.get("assignment");
  if (assignment) {
    if (!["assigned", "unassigned"].includes(assignment)) {
      return NextResponse.json(
        { error: "assignment must be assigned or unassigned" },
        { status: 400 },
      );
    }
    filters.push(
      assignment === "assigned"
        ? "(l.current_owner_user_id IS NOT NULL OR l.current_team_id IS NOT NULL)"
        : "(l.current_owner_user_id IS NULL AND l.current_team_id IS NULL)",
    );
  }
  for (const field of [
    "current_owner_user_id",
    "current_team_id",
    "stage_id",
  ] as const) {
    const value = request.nextUrl.searchParams.get(field);
    if (value) {
      if (!isUuid(value)) {
        return NextResponse.json(
          { error: `${field} must be a valid UUID` },
          { status: 400 },
        );
      }
      values.push(value);
      filters.push(`l.${field}=$${values.length}`);
    }
  }
  const search = request.nextUrl.searchParams.get("search")?.trim();
  if (search) {
    values.push(`%${search}%`);
    filters.push(
      `(c.first_name ILIKE $${values.length} OR c.last_name ILIKE $${values.length} OR c.email ILIKE $${values.length} OR c.phone_number ILIKE $${values.length})`,
    );
  }
  const sortOptions: Record<string, string> = {
    newest: "l.created_at DESC, l.lead_id DESC",
    oldest: "l.created_at ASC, l.lead_id ASC",
    recently_updated: "l.updated_at DESC, l.lead_id DESC",
    name_asc:
      "LOWER(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) ASC, l.lead_id ASC",
    name_desc:
      "LOWER(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) DESC, l.lead_id DESC",
    budget_high: "l.budget DESC NULLS LAST, l.lead_id DESC",
    budget_low: "l.budget ASC NULLS LAST, l.lead_id ASC",
  };
  const sort = request.nextUrl.searchParams.get("sort") || "newest";
  const orderBy = sortOptions[sort];
  if (!orderBy) {
    return NextResponse.json({ error: "Invalid lead sort" }, { status: 400 });
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM leads l
       JOIN contacts c ON c.contact_id=l.contact_id ${where}`,
      values,
    );
    const summary = await pool.query(
      `SELECT
         COUNT(*)::integer AS total,
         COUNT(*) FILTER (WHERE l.status = 'qualified')::integer AS qualified,
         COUNT(*) FILTER (WHERE l.temperature = 'hot')::integer AS hot,
         COUNT(*) FILTER (
           WHERE na.status = 'pending' AND na.due_at <= CURRENT_TIMESTAMP
         )::integer AS needs_follow_up,
         COUNT(*) FILTER (
           WHERE l.current_owner_user_id IS NULL AND l.current_team_id IS NULL
         )::integer AS unassigned
       FROM leads l
       JOIN contacts c ON c.contact_id=l.contact_id
       LEFT JOIN lead_next_actions na ON na.lead_id=l.lead_id
       ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT l.*, c.first_name, c.last_name, c.email, c.phone_number,
              p.project_code, p.project_name,
              s.stage_key, s.stage_name
       FROM leads l JOIN contacts c ON c.contact_id=l.contact_id
       JOIN projects p ON p.project_id=l.project_id
       LEFT JOIN project_lead_stages s ON s.stage_id=l.stage_id
       ${where} ORDER BY ${orderBy}
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    const summaryRow = summary.rows[0] ?? {};
    return NextResponse.json({
      leads: result.rows,
      summary: {
        total: Number(summaryRow.total ?? 0),
        qualified: Number(summaryRow.qualified ?? 0),
        hot: Number(summaryRow.hot ?? 0),
        needsFollowUp: Number(summaryRow.needs_follow_up ?? 0),
        unassigned: Number(summaryRow.unassigned ?? 0),
      },
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list leads", error);
    return NextResponse.json(
      { error: "Unable to retrieve leads" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authentication = await authenticateRequest(request);
  if (!authentication.ok) return authentication.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const validation = validateLeadPayload(body, { partial: false });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  let projectAccess;
  try {
    projectAccess = await getUserProjectAccess(
      authentication.auth.user.user_id,
    );
  } catch (error) {
    console.error("Failed to resolve lead project access", error);
    return NextResponse.json(
      { error: "Unable to resolve project access" },
      { status: 500 },
    );
  }
  if (
    !projectAccess ||
    !validation.data.project_id ||
    !canAccessProject(projectAccess, validation.data.project_id)
  ) {
    return NextResponse.json(
      { error: "You do not have access to this project" },
      { status: 403 },
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lead = await createLead(client, validation.data);
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Lead created", lead },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof LeadReferenceError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error("Failed to create lead", error);
    return NextResponse.json(
      { error: "Unable to create lead" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
