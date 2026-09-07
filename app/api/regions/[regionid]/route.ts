import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getDatabaseErrorCode,
  parseRegionId,
  REGION_COLUMNS,
  RegionField,
  serializeRegion,
  validateRegionPayload,
} from "@/lib/regions";

type RegionContext = {
  params: Promise<{ regionid: string }>;
};

export async function GET(_request: NextRequest, context: RegionContext) {
    
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
      `SELECT ${REGION_COLUMNS} FROM regions WHERE region_id = $1`,
      [regionId],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Region not found" }, { status: 404 });
    }

    return NextResponse.json({ region: serializeRegion(result.rows[0]) });

  } catch (error) {
    console.error("Failed to retrieve region", error);
    return NextResponse.json(
      { error: "Unable to retrieve region" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: RegionContext) {
  const { regionid } = await context.params;
  const regionId = parseRegionId(regionid);

  if (regionId === null) {
    return NextResponse.json(
      { error: "regionid must be a positive integer" },
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

  const validation = validateRegionPayload(body, { partial: true });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const updates = Object.entries(validation.data) as [
    RegionField,
    string | number | boolean | null,
  ][];
  const values: (string | number | boolean | null)[] = updates.map(
    ([, value]) => value,
  );
  const assignments = updates.map(
    ([field], index) => `${field} = $${index + 1}`,
  );
  values.push(regionId);

  try {
    const result = await pool.query(
      `UPDATE regions
       SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
       WHERE region_id = $${values.length}
       RETURNING ${REGION_COLUMNS}`,
      values,
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Region not found" }, { status: 404 });
    }

    return NextResponse.json({
      message: "Region updated",
      region: serializeRegion(result.rows[0]),
    });
  } catch (error) {
    if (getDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "A region with this region_code already exists" },
        { status: 409 },
      );
    }

    console.error("Failed to update region", error);
    return NextResponse.json(
      { error: "Unable to update region" },
      { status: 500 },
    );
  }
}
