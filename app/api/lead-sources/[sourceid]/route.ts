import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  LEAD_SOURCE_COLUMNS,
  LeadSourceWrite,
  parseUuidId,
  validateLeadSourcePayload,
} from "@/lib/leadAttribution";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";

type Context = { params: Promise<{ sourceid: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const id = parseUuidId((await context.params).sourceid);
  if (!id) {
    return NextResponse.json(
      { error: "sourceId must be a valid UUID" },
      { status: 400 },
    );
  }
  try {
    const result = await pool.query(
      `SELECT ${LEAD_SOURCE_COLUMNS} FROM lead_sources WHERE source_id = $1`,
      [id],
    );
    if (!result.rowCount) {
      return NextResponse.json(
        { error: "Lead source not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ source: result.rows[0] });
  } catch (error) {
    console.error("Failed to retrieve lead source", error);
    return NextResponse.json(
      { error: "Unable to retrieve lead source" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const id = parseUuidId((await context.params).sourceid);
  if (!id) {
    return NextResponse.json(
      { error: "sourceId must be a valid UUID" },
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
  const validation = validateLeadSourcePayload(body, true);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  const fields: (keyof LeadSourceWrite)[] = [
    "source_name",
    "source_type",
    "code",
  ];
  const updates = fields.filter(
    (field) => validation.data[field] !== undefined,
  );
  const values = updates.map((field) => validation.data[field]);
  const assignments = updates.map((field, index) => `${field} = $${index + 1}`);
  values.push(id);
  try {
    const result = await pool.query(
      `UPDATE lead_sources SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
       WHERE source_id = $${values.length} RETURNING ${LEAD_SOURCE_COLUMNS}`,
      values,
    );
    if (!result.rowCount) {
      return NextResponse.json(
        { error: "Lead source not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      message: "Lead source updated",
      source: result.rows[0],
    });
  } catch (error) {
    if (getDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "Lead source code already exists" },
        { status: 409 },
      );
    }
    console.error("Failed to update lead source", error);
    return NextResponse.json(
      { error: "Unable to update lead source" },
      { status: 500 },
    );
  }
}
