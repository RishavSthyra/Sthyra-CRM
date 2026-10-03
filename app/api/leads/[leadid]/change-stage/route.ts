import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getProjectStage, lockLead, transitionLead } from "@/lib/leadCommands";
import { parseLeadId } from "@/lib/leads";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

type Context = { params: Promise<{ leadid: string }> };
export async function POST(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
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
    typeof body.stage_key !== "string" ||
    !body.stage_key.trim()
  ) {
    return NextResponse.json(
      { error: "stage_key is required" },
      { status: 422 },
    );
  }
  const errors: string[] = [];
  const reason = validateText(body.reason, "reason", 5000, false, errors);
  if (!reason) errors.push("reason is required");
  Object.keys(body)
    .filter((key) => !["stage_key", "reason"].includes(key))
    .forEach((key) => errors.push(`Unknown field: ${key}`));
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
      ["qualified", "closed", "duplicate", "invalid"].includes(
        lead.status as string,
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            lead.status === "qualified"
              ? "Converted leads are managed through their opportunity"
              : `Cannot change stage while lead is ${lead.status}`,
        },
        { status: 409 },
      );
    }
    const stage = await getProjectStage(
      client,
      lead.project_id as number,
      body.stage_key,
    );
    if (!stage) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Active project stage not found" },
        { status: 422 },
      );
    }
    if (stage.is_terminal) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Use the close command for terminal stages" },
        { status: 422 },
      );
    }
    const updated = await transitionLead(
      client,
      lead,
      "change_stage",
      lead.status as string,
      stage.stage_id as string,
      {},
      { stage_key: stage.stage_key, reason },
      scope.context.userId,
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Lead stage changed", lead: updated });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to change lead stage", error);
    return NextResponse.json(
      { error: "Unable to change lead stage" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
