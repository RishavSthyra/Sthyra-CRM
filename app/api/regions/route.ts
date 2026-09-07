import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getDatabaseErrorCode,
  REGION_COLUMNS,
  serializeRegion,
  validateRegionPayload,
} from "@/lib/regions";

function parsePositiveInteger(
  value: string | null,
  fallback: number,
): number | null {
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

  const includeInactive = includeInactiveValue === "true";
  const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
  const filters: string[] = [];
  const values: unknown[] = [];

  if (!includeInactive) filters.push("is_active = TRUE");

  if (search) {
    values.push(`%${search}%`);
    const searchParameter = `$${values.length}`;
    filters.push(
      `(region_name ILIKE ${searchParameter} OR region_code ILIKE ${searchParameter} OR state ILIKE ${searchParameter})`,
    );
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * limit;

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM regions ${whereClause}`,
      values,
    );

    const listValues = [...values, limit, offset];
    const result = await pool.query(
      `SELECT ${REGION_COLUMNS}
       FROM regions
       ${whereClause}
       ORDER BY region_name ASC, region_id ASC
       LIMIT $${listValues.length - 1}
       OFFSET $${listValues.length}`,
      listValues,
    );

    const total = Number(countResult.rows[0]?.total ?? 0);

    return NextResponse.json({
      regions: result.rows.map(serializeRegion),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Failed to list regions", error);
    return NextResponse.json(
      { error: "Unable to retrieve regions" },
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

  const validation = validateRegionPayload(body, { partial: false });
  
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const region = validation.data;

  try {
    const result = await pool.query(
      `INSERT INTO regions (
        region_name,
        region_code,
        region_type,
        state,
        latitude,
        longitude,
        timezone,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING ${REGION_COLUMNS}`,
      [
        region.region_name,
        region.region_code,
        region.region_type ?? null,
        region.state ?? null,
        region.latitude ?? null,
        region.longitude ?? null,
        region.timezone ?? null,
        region.is_active,
      ],
    );

    return NextResponse.json(
      { message: "Region created", region: serializeRegion(result.rows[0]) },
      { status: 201 },
    );
  } catch (error) {
    if (getDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "A region with this region_code already exists" },
        { status: 409 },
      );
    }

    console.error("Failed to create region", error);
    return NextResponse.json(
      { error: "Unable to create region" },
      { status: 500 },
    );
  }
}
