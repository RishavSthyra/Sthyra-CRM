import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  parseUuidId,
  TAG_COLUMNS,
  TagWrite,
  validateTagPayload,
} from "@/lib/leadAttribution";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";
type Context = { params: Promise<{ tagid: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const id = parseUuidId((await context.params).tagid);
  if (!id) {
    return NextResponse.json(
      { error: "tagId must be a valid UUID" },
      { status: 400 },
    );
  }
  try {
    const result = await pool.query(
      `SELECT ${TAG_COLUMNS} FROM tags WHERE tag_id=$1 AND archived_at IS NULL`,
      [id],
    );
    if (!result.rowCount) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }
    return NextResponse.json({ tag: result.rows[0] });
  } catch (error) {
    console.error("Failed to retrieve tag", error);
    return NextResponse.json(
      { error: "Unable to retrieve tag" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const id = parseUuidId((await context.params).tagid);
  if (!id) {
    return NextResponse.json(
      { error: "tagId must be a valid UUID" },
      { status: 400 },
    );
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
  const validation = validateTagPayload(body, true);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  const fields: (keyof TagWrite)[] = ["tag_name", "description", "color"];
  const updates = fields.filter(
    (field) => validation.data[field] !== undefined,
  );
  const values = updates.map((field) => validation.data[field]);
  const assignments = updates.map((field, index) => `${field}=$${index + 1}`);
  values.push(id);
  try {
    const result = await pool.query(
      `UPDATE tags SET ${assignments.join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE tag_id=$${values.length} AND archived_at IS NULL RETURNING ${TAG_COLUMNS}`,
      values,
    );
    if (!result.rowCount) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }
    return NextResponse.json({ message: "Tag updated", tag: result.rows[0] });
  } catch (error) {
    if (getDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "An active tag with this name already exists" },
        { status: 409 },
      );
    }
    console.error("Failed to update tag", error);
    return NextResponse.json(
      { error: "Unable to update tag" },
      { status: 500 },
    );
  }
}
