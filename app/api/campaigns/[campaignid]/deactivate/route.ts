import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { CAMPAIGN_COLUMNS, parseUuidId } from "@/lib/leadAttribution";
type Context = { params: Promise<{ campaignid: string }> };
export async function POST(_request: NextRequest, context: Context) {
  const id = parseUuidId((await context.params).campaignid);
  if (!id) {
    return NextResponse.json(
      { error: "campaignId must be a valid UUID" },
      { status: 400 },
    );
  }
  try {
    const result = await pool.query(
      `UPDATE campaigns SET is_active=FALSE, updated_at=CURRENT_TIMESTAMP WHERE campaign_id=$1 RETURNING ${CAMPAIGN_COLUMNS}`,
      [id],
    );
    if (!result.rowCount) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      message: "Campaign deactivated",
      campaign: result.rows[0],
    });
  } catch (error) {
    console.error("Failed to deactivate campaign", error);
    return NextResponse.json(
      { error: "Unable to deactivate campaign" },
      { status: 500 },
    );
  }
}
