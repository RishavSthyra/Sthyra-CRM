import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseUuidId, TAG_COLUMNS } from "@/lib/leadAttribution";
type Context = { params: Promise<{ tagid: string }> };
export async function POST(_request: NextRequest, context: Context) {
  const id = parseUuidId((await context.params).tagid);
  if (!id) {
    return NextResponse.json(
      { error: "tagId must be a valid UUID" },
      { status: 400 },
    );
  }
  try {
    const result = await pool.query(
      `UPDATE tags SET archived_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE tag_id=$1 AND archived_at IS NULL RETURNING ${TAG_COLUMNS}`,
      [id],
    );
    if (!result.rowCount) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }
    return NextResponse.json({ message: "Tag archived", tag: result.rows[0] });
  } catch (error) {
    console.error("Failed to archive tag", error);
    return NextResponse.json(
      { error: "Unable to archive tag" },
      { status: 500 },
    );
  }
}
