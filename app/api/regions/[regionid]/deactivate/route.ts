import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  parseRegionId,
  REGION_COLUMNS,
  serializeRegion,
} from "@/lib/regions";

type RegionContext = {
  params: Promise<{ regionid: string }>;
};

export async function POST(_request: NextRequest, context: RegionContext) {
  const { regionid } = await context.params;
  const regionId = parseRegionId(regionid);

  if (regionId === null) {
    return NextResponse.json(
      { error: "regionid must be a positive integer" },
      { status: 400 },
    );
  }

  try {
    const result = await pool.query(
      `UPDATE regions
       SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE region_id = $1
       RETURNING ${REGION_COLUMNS}`,
      [regionId],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Region not found" }, { status: 404 });
    }

    return NextResponse.json({
      message: "Region deactivated",
      region: serializeRegion(result.rows[0]),
    });
  } catch (error) {
    console.error("Failed to deactivate region", error);
    return NextResponse.json(
      { error: "Unable to deactivate region" },
      { status: 500 },
    );
  }
}
