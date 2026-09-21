import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { LEAD_SOURCE_COLUMNS, parseUuidId } from "@/lib/leadAttribution";

type Context = { params: Promise<{ sourceid: string }> };
export async function POST(_request: NextRequest, context: Context) {
  const id = parseUuidId((await context.params).sourceid);
  if (!id) {
    return NextResponse.json(
      { error: "sourceId must be a valid UUID" },
      { status: 400 },
    );
  }
  try {
    const result = await pool.query(
      `UPDATE lead_sources SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE source_id = $1 RETURNING ${LEAD_SOURCE_COLUMNS}`,
      [id],
    );
    if (!result.rowCount) {
      return NextResponse.json(
        { error: "Lead source not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      message: "Lead source deactivated",
      source: result.rows[0],
    });
  } catch (error) {
    console.error("Failed to deactivate lead source", error);
    return NextResponse.json(
      { error: "Unable to deactivate lead source" },
      { status: 500 },
    );
  }
}
