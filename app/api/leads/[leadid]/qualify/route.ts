import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getProjectStage,
  lockLead,
  transitionLead,
  validateQualificationValues,
} from "@/lib/leadCommands";
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
    !isObject(body.qualification_data) ||
    Array.isArray(body.qualification_data)
  ) {
    return NextResponse.json(
      { error: "qualification_data must be a JSON object" },
      { status: 422 },
    );
  }
  if (
    body.stage_key !== undefined &&
    (typeof body.stage_key !== "string" || !body.stage_key.trim())
  ) {
    return NextResponse.json(
      { error: "stage_key must be a non-empty string" },
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
    if (!["active", "nurture"].includes(lead.status as string)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `Cannot qualify a ${lead.status} lead` },
        { status: 409 },
      );
    }
    const errors = await validateQualificationValues(
      client,
      lead.project_id as number,
      body.qualification_data,
    );
    if (errors.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Validation failed", details: errors },
        { status: 422 },
      );
    }
    let stageId = lead.stage_id as string | null;
    if (typeof body.stage_key === "string") {
      const stage = await getProjectStage(
        client,
        lead.project_id as number,
        body.stage_key,
      );
      if (!stage || stage.is_terminal) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Valid non-terminal project stage not found" },
          { status: 422 },
        );
      }
      stageId = stage.stage_id as string;
    }
    const updated = await transitionLead(
      client,
      lead,
      "qualify",
      "qualified",
      stageId,
      { qualification_data: body.qualification_data, qualified_at: new Date() },
      { qualification_data: body.qualification_data },
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Lead qualified", lead: updated });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to qualify lead", error);
    return NextResponse.json(
      { error: "Unable to qualify lead" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
