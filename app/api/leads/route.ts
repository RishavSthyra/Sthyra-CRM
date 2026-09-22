import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  createLead,
  LeadReferenceError,
  validateLeadPayload,
} from "@/lib/leads";
import { isUuid } from "@/lib/permissions";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  const values: unknown[] = [];
  const filters = ["1=1"];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue !== null) {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId) {
      return NextResponse.json(
        { error: "project_id must be a positive integer" },
        { status: 400 },
      );
    }
    values.push(projectId);
    filters.push(`l.project_id=$${values.length}`);
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
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM leads l
       JOIN contacts c ON c.contact_id=l.contact_id ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT l.*, c.first_name, c.last_name, c.email, c.phone_number,
              s.stage_key, s.stage_name
       FROM leads l JOIN contacts c ON c.contact_id=l.contact_id
       LEFT JOIN project_lead_stages s ON s.stage_id=l.stage_id
       ${where} ORDER BY l.created_at DESC, l.lead_id DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      leads: result.rows,
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
