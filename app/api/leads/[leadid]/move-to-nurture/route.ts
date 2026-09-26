import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getProjectStage, lockLead, transitionLead } from "@/lib/leadCommands";
import { parseLeadId } from "@/lib/leads";
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
  let body: unknown = {};
  try {
    if (request.headers.get("content-length") !== "0") {
      body = await request.json();
    }
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  if (!isObject(body) || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be an object" },
      { status: 422 },
    );
  }
  const errors: string[] = [];
  const reason = validateText(body.reason, "reason", 5000, true, errors);
  let nurtureUntil: string | null = null;
  if (body.nurture_until !== undefined && body.nurture_until !== null) {
    if (
      typeof body.nurture_until !== "string" ||
      Number.isNaN(Date.parse(body.nurture_until)) ||
      new Date(body.nurture_until).getTime() <= Date.now()
    ) {
      errors.push("nurture_until must be a future ISO date-time or null");
    } else {
      nurtureUntil = new Date(body.nurture_until).toISOString();
    }
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
    if (
      ["qualified", "closed", "duplicate", "invalid", "nurture"].includes(
        lead.status as string,
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `Cannot nurture a ${lead.status} lead` },
        { status: 409 },
      );
    }
    const nurtureStage = await getProjectStage(
      client,
      lead.project_id as number,
      "nurturing",
    );
    if (!nurtureStage) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "The project does not have an active nurturing stage" },
        { status: 409 },
      );
    }
    const updated = await transitionLead(
      client,
      lead,
      "move_to_nurture",
      "nurture",
      nurtureStage.stage_id as string,
      { nurture_reason: reason ?? null, nurture_until: nurtureUntil },
      { reason: reason ?? null, nurture_until: nurtureUntil },
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Lead moved to nurture",
      lead: updated,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to nurture lead", error);
    return NextResponse.json(
      { error: "Unable to nurture lead" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
