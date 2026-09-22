import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseLeadId } from "@/lib/leads";
import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";

type Context = { params: Promise<{ leadid: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const leadId = parseLeadId((await context.params).leadid);
  if (!leadId) {
    return NextResponse.json(
      { error: "leadId must be a valid UUID" },
      { status: 400 },
    );
  }

  try {
    const lead = await pool.query("SELECT 1 FROM leads WHERE lead_id=$1", [
      leadId,
    ]);
    if (!lead.rowCount) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    const result = await pool.query(
      `SELECT t.tag_id, t.tag_name, t.description, t.color, lt.created_at AS assigned_at
       FROM lead_tags lt
       JOIN tags t ON t.tag_id=lt.tag_id
       WHERE lt.lead_id=$1
       ORDER BY t.tag_name, t.tag_id`,
      [leadId],
    );
    return NextResponse.json({ tags: result.rows });
  } catch (error) {
    console.error("Failed to retrieve lead tags", error);
    return NextResponse.json(
      { error: "Unable to retrieve lead tags" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: Context) {
  const leadId = parseLeadId((await context.params).leadid);
  if (!leadId) {
    return NextResponse.json(
      { error: "leadId must be a valid UUID" },
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
  if (!isObject(body) || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 422 },
    );
  }
  const unknown = Object.keys(body).filter(
    (field) => !["tag_id", "tag_ids"].includes(field),
  );
  const supplied = [
    body.tag_id !== undefined,
    body.tag_ids !== undefined,
  ].filter(Boolean).length;
  const rawTagIds = body.tag_id !== undefined ? [body.tag_id] : body.tag_ids;
  const errors = unknown.map((field) => `Unknown field: ${field}`);
  if (supplied !== 1) {
    errors.push("Provide exactly one of tag_id or tag_ids");
  }
  if (
    !Array.isArray(rawTagIds) ||
    rawTagIds.length === 0 ||
    rawTagIds.some((tagId) => !isUuid(tagId))
  ) {
    errors.push(
      "tag_id must be a UUID or tag_ids must be a non-empty UUID array",
    );
  }
  if (errors.length) {
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  }
  const tagIds = [
    ...new Set((rawTagIds as string[]).map((tagId) => tagId.toLowerCase())),
  ];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lead = await client.query(
      "SELECT 1 FROM leads WHERE lead_id=$1 FOR UPDATE",
      [leadId],
    );
    if (!lead.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    const tags = await client.query(
      `SELECT tag_id FROM tags
       WHERE tag_id=ANY($1::uuid[]) AND archived_at IS NULL`,
      [tagIds],
    );
    if (tags.rowCount !== tagIds.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "One or more active tags were not found" },
        { status: 422 },
      );
    }
    const inserted = await client.query(
      `INSERT INTO lead_tags (lead_id, tag_id)
       SELECT $1, tag_id FROM UNNEST($2::uuid[]) AS requested(tag_id)
       ON CONFLICT DO NOTHING
       RETURNING tag_id`,
      [leadId, tagIds],
    );
    if (inserted.rowCount) {
      await client.query(
        `INSERT INTO lead_tag_history (lead_id, tag_id, action)
         SELECT $1, tag_id, 'added' FROM UNNEST($2::uuid[]) AS added(tag_id)`,
        [leadId, inserted.rows.map((row) => row.tag_id)],
      );
    }
    await client.query("COMMIT");
    return NextResponse.json(
      {
        message: "Lead tags added",
        added_tag_ids: inserted.rows.map((row) => row.tag_id),
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to add lead tags", error);
    return NextResponse.json(
      { error: "Unable to add lead tags" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
