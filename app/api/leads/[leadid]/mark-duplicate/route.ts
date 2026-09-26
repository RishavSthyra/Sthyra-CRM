import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { lockLead, transitionLead } from "@/lib/leadCommands";
import { parseLeadId } from "@/lib/leads";
import { isObject } from "@/utils/isObject";

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
  if (
    !isObject(body) ||
    !parseLeadId(String(body.duplicate_of_lead_id ?? ""))
  ) {
    return NextResponse.json(
      { error: "duplicate_of_lead_id must be a valid UUID" },
      { status: 422 },
    );
  }
  const targetId = parseLeadId(body.duplicate_of_lead_id as string)!;
  if (targetId === leadId) {
    return NextResponse.json(
      { error: "A lead cannot duplicate itself" },
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
    if (["qualified", "closed", "duplicate"].includes(lead.status as string)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            lead.status === "qualified"
              ? "Converted leads cannot be marked as duplicates"
              : `Cannot mark a ${lead.status} lead as duplicate`,
        },
        { status: 409 },
      );
    }
    const target = await client.query(
      "SELECT lead_id FROM leads WHERE lead_id=$1 AND project_id=$2 AND status<>'duplicate'",
      [targetId, lead.project_id],
    );
    if (!target.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Valid canonical lead in this project not found" },
        { status: 422 },
      );
    }
    const updated = await transitionLead(
      client,
      lead,
      "mark_duplicate",
      "duplicate",
      lead.stage_id as string | null,
      { duplicate_of_lead_id: targetId },
      { duplicate_of_lead_id: targetId },
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Lead marked as duplicate",
      lead: updated,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to mark lead duplicate", error);
    return NextResponse.json(
      { error: "Unable to mark lead duplicate" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
