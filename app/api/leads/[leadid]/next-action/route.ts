import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  leadExists,
  NEXT_ACTION_COLUMNS,
  validateNextActionPayload,
} from "@/lib/leadHistory";
import { parseLeadId } from "@/lib/leads";

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
    if (!(await leadExists(pool, leadId))) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    const result = await pool.query(
      `SELECT ${NEXT_ACTION_COLUMNS} FROM lead_next_actions WHERE lead_id=$1`,
      [leadId],
    );
    return NextResponse.json({ next_action: result.rows[0] ?? null });
  } catch (error) {
    console.error("Failed to retrieve lead next action", error);
    return NextResponse.json(
      { error: "Unable to retrieve lead next action" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, context: Context) {
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
  const validation = validateNextActionPayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

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
    const previous = await client.query(
      "SELECT * FROM lead_next_actions WHERE lead_id=$1 FOR UPDATE",
      [leadId],
    );
    const result = await client.query(
      `INSERT INTO lead_next_actions (
         lead_id, action_type, summary, due_at, status, notes
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (lead_id) DO UPDATE SET
         action_type=EXCLUDED.action_type,
         summary=EXCLUDED.summary,
         due_at=EXCLUDED.due_at,
         status=EXCLUDED.status,
         notes=EXCLUDED.notes,
         updated_at=CURRENT_TIMESTAMP
       RETURNING ${NEXT_ACTION_COLUMNS}`,
      [
        leadId,
        validation.data.action_type,
        validation.data.summary,
        validation.data.due_at,
        validation.data.status,
        validation.data.notes,
      ],
    );
    await client.query(
      `INSERT INTO lead_next_action_history (
         lead_id, previous_action, next_action
       ) VALUES ($1,$2::jsonb,$3::jsonb)`,
      [
        leadId,
        previous.rows[0] ? JSON.stringify(previous.rows[0]) : null,
        JSON.stringify(result.rows[0]),
      ],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Lead next action saved",
      next_action: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to save lead next action", error);
    return NextResponse.json(
      { error: "Unable to save lead next action" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
