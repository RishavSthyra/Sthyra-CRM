import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  LEAD_SOURCE_COLUMNS,
  validateLeadSourcePayload,
} from "@/lib/leadAttribution";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  const activeValue = request.nextUrl.searchParams.get("is_active");
  if (activeValue !== null && !["true", "false"].includes(activeValue)) {
    return NextResponse.json(
      { error: "is_active must be true or false" },
      { status: 400 },
    );
  }
  const values: unknown[] = [];
  const filters = ["1 = 1"];
  if (activeValue !== null) {
    values.push(activeValue === "true");
    filters.push(`is_active = $${values.length}`);
  }
  const search = request.nextUrl.searchParams.get("search")?.trim();
  if (search) {
    values.push(`%${search}%`);
    filters.push(
      `(source_name ILIKE $${values.length} OR code ILIKE $${values.length})`,
    );
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM lead_sources ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${LEAD_SOURCE_COLUMNS} FROM lead_sources ${where}
       ORDER BY source_name, source_id LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      sources: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list lead sources", error);
    return NextResponse.json(
      { error: "Unable to retrieve lead sources" },
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
  const validation = validateLeadSourcePayload(body, false);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  try {
    const result = await pool.query(
      `INSERT INTO lead_sources (source_name, source_type, code)
       VALUES ($1, $2, $3) RETURNING ${LEAD_SOURCE_COLUMNS}`,
      [
        validation.data.source_name,
        validation.data.source_type,
        validation.data.code,
      ],
    );
    return NextResponse.json(
      { message: "Lead source created", source: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    if (getDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "Lead source code already exists" },
        { status: 409 },
      );
    }
    console.error("Failed to create lead source", error);
    return NextResponse.json(
      { error: "Unable to create lead source" },
      { status: 500 },
    );
  }
}
