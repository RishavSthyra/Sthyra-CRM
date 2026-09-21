import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  CAMPAIGN_COLUMNS,
  CampaignWrite,
  parseUuidId,
  validateCampaignPayload,
} from "@/lib/leadAttribution";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";

type Context = { params: Promise<{ campaignid: string }> };
export async function GET(_request: NextRequest, context: Context) {
  const id = parseUuidId((await context.params).campaignid);
  if (!id) {
    return NextResponse.json(
      { error: "campaignId must be a valid UUID" },
      { status: 400 },
    );
  }
  try {
    const result = await pool.query(
      `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns WHERE campaign_id = $1`,
      [id],
    );
    if (!result.rowCount) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ campaign: result.rows[0] });
  } catch (error) {
    console.error("Failed to retrieve campaign", error);
    return NextResponse.json(
      { error: "Unable to retrieve campaign" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const id = parseUuidId((await context.params).campaignid);
  if (!id) {
    return NextResponse.json(
      { error: "campaignId must be a valid UUID" },
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
  const validation = validateCampaignPayload(body, true);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  const fields: (keyof CampaignWrite)[] = [
    "source_id",
    "campaign_name",
    "campaign_code",
    "campaign_type",
    "start_date",
    "end_date",
    "budget",
  ];
  const updates = fields.filter(
    (field) => validation.data[field] !== undefined,
  );
  const values = updates.map((field) => validation.data[field]);
  const assignments = updates.map((field, index) => `${field} = $${index + 1}`);
  values.push(id);
  try {
    if (validation.data.source_id) {
      const source = await pool.query(
        "SELECT source_id FROM lead_sources WHERE source_id = $1 AND is_active = TRUE",
        [validation.data.source_id],
      );
      if (!source.rowCount) {
        return NextResponse.json(
          { error: "Active lead source not found" },
          { status: 422 },
        );
      }
    }
    const result = await pool.query(
      `UPDATE campaigns SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE campaign_id = $${values.length} RETURNING ${CAMPAIGN_COLUMNS}`,
      values,
    );
    if (!result.rowCount) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      message: "Campaign updated",
      campaign: result.rows[0],
    });
  } catch (error) {
    if (getDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "Campaign code already exists" },
        { status: 409 },
      );
    }
    if (getDatabaseErrorCode(error) === "23514") {
      return NextResponse.json(
        { error: "Campaign dates or budget are invalid" },
        { status: 422 },
      );
    }
    console.error("Failed to update campaign", error);
    return NextResponse.json(
      { error: "Unable to update campaign" },
      { status: 500 },
    );
  }
}
