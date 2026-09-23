import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getProjectStage, lockLead, transitionLead } from "@/lib/leadCommands";
import { parseLeadId } from "@/lib/leads";
import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

type Context = { params: Promise<{ leadid: string }> };
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
  if (!isObject(body)) {
    return NextResponse.json(
      { error: "Request body must be an object" },
      { status: 422 },
    );
  }
  const errors: string[] = [];
  if (!isUuid(body.closing_reason_id)) {
    errors.push("closing_reason_id must be a valid UUID");
  }
  const notes = validateText(body.notes, "notes", 5000, true, errors);
  if (body.stage_key !== undefined && typeof body.stage_key !== "string") {
    errors.push("stage_key must be a string");
  }
  if (errors.length) {
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lead = await lockLead(client, leadId);
    if (!lead) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    if (["closed", "duplicate", "invalid"].includes(lead.status as string)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `Cannot close a ${lead.status} lead` },
        { status: 409 },
      );
    }
    const reason = await client.query(
      "SELECT reason_id, outcome FROM project_closing_reasons WHERE reason_id=$1 AND project_id=$2 AND is_active=TRUE",
      [body.closing_reason_id, lead.project_id],
    );
    if (!reason.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Active project closing reason not found" },
        { status: 422 },
      );
    }
    const outcome = reason.rows[0].outcome as string;
    const defaultTerminalStageKey = outcome === "won" ? "won" : "lost";
    let stage;
    if (typeof body.stage_key === "string") {
      stage = await getProjectStage(
        client,
        lead.project_id as number,
        body.stage_key,
      );
    } else {
      stage = (
        await client.query(
          `SELECT stage_id, stage_key, is_terminal
           FROM project_lead_stages
           WHERE project_id=$1 AND is_active=TRUE AND is_terminal=TRUE
           ORDER BY (stage_key=$2) DESC, position
           LIMIT 1`,
          [lead.project_id, defaultTerminalStageKey],
        )
      ).rows[0];
    }
    if (!stage || !stage.is_terminal) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "A terminal project stage is required" },
        { status: 422 },
      );
    }
    if (
      ["won", "lost"].includes(stage.stage_key as string) &&
      stage.stage_key !== defaultTerminalStageKey
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: `Select the ${defaultTerminalStageKey} stage for this closing reason`,
        },
        { status: 422 },
      );
    }
    const updated = await transitionLead(
      client,
      lead,
      "close",
      "closed",
      stage.stage_id,
      {
        closing_reason_id: body.closing_reason_id,
        closing_notes: notes ?? null,
        closed_at: new Date(),
      },
      {
        closing_reason_id: body.closing_reason_id,
        outcome,
      },
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Lead closed", lead: updated });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to close lead", error);
    return NextResponse.json(
      { error: "Unable to close lead" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
