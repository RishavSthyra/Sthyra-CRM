import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { TAG_COLUMNS, validateTagPayload } from "@/lib/leadAttribution";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  const search = request.nextUrl.searchParams.get("search")?.trim();
  const values: unknown[] = [];
  let filter = "archived_at IS NULL";
  if (search) {
    values.push(`%${search}%`);
    filter += ` AND tag_name ILIKE $${values.length}`;
  }
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM tags WHERE ${filter}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${TAG_COLUMNS} FROM tags WHERE ${filter} ORDER BY tag_name, tag_id LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      tags: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list tags", error);
    return NextResponse.json(
      { error: "Unable to retrieve tags" },
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
  const validation = validateTagPayload(body, false);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  try {
    const result = await pool.query(
      `INSERT INTO tags (tag_name, description, color) VALUES ($1, $2, $3) RETURNING ${TAG_COLUMNS}`,
      [
        validation.data.tag_name,
        validation.data.description ?? null,
        validation.data.color ?? null,
      ],
    );
    return NextResponse.json(
      { message: "Tag created", tag: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    if (getDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "An active tag with this name already exists" },
        { status: 409 },
      );
    }
    console.error("Failed to create tag", error);
    return NextResponse.json(
      { error: "Unable to create tag" },
      { status: 500 },
    );
  }
}
