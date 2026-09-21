import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  CAMPAIGN_COLUMNS,
  parseUuidId,
  validateCampaignPayload,
} from "@/lib/leadAttribution";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  const values: unknown[] = [];
  const filters = ["1 = 1"];
  const active = request.nextUrl.searchParams.get("is_active");
  if (active !== null) {
    if (!["true", "false"].includes(active)) {
      return NextResponse.json(
        { error: "is_active must be true or false" },
        { status: 400 },
      );
    }
    values.push(active === "true");
    filters.push(`is_active = $${values.length}`);
  }
  const source = request.nextUrl.searchParams.get("source_id");
  if (source) {
    const sourceId = parseUuidId(source);
    if (!sourceId) {
      return NextResponse.json(
        { error: "source_id must be a valid UUID" },
        { status: 400 },
      );
    }
    values.push(sourceId);
    filters.push(`source_id = $${values.length}`);
  }
  const search = request.nextUrl.searchParams.get("search")?.trim();
  if (search) {
    values.push(`%${search}%`);
    filters.push(
      `(campaign_name ILIKE $${values.length} OR campaign_code ILIKE $${values.length})`,
    );
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM campaigns ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns ${where} ORDER BY created_at DESC, campaign_id LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      campaigns: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list campaigns", error);
    return NextResponse.json(
      { error: "Unable to retrieve campaigns" },
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
  const validation = validateCampaignPayload(body, false);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  const item = validation.data;
  try {
    if (item.source_id) {
      const source = await pool.query(
        "SELECT source_id FROM lead_sources WHERE source_id = $1 AND is_active = TRUE",
        [item.source_id],
      );
      if (!source.rowCount) {
        return NextResponse.json(
          { error: "Active lead source not found" },
          { status: 422 },
        );
      }
    }
    const result = await pool.query(
      `INSERT INTO campaigns (source_id, campaign_name, campaign_code, campaign_type, start_date, end_date, budget)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${CAMPAIGN_COLUMNS}`,
      [
        item.source_id ?? null,
        item.campaign_name,
        item.campaign_code,
        item.campaign_type ?? null,
        item.start_date ?? null,
        item.end_date ?? null,
        item.budget ?? null,
      ],
    );
    return NextResponse.json(
      { message: "Campaign created", campaign: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    if (getDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "Campaign code already exists" },
        { status: 409 },
      );
    }
    console.error("Failed to create campaign", error);
    return NextResponse.json(
      { error: "Unable to create campaign" },
      { status: 500 },
    );
  }
}
