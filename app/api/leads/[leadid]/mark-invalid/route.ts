import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { lockLead, transitionLead } from "@/lib/leadCommands";
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
  const reason = validateText(body.reason, "reason", 5000, false, errors);
  if (body.reason === undefined) {
    errors.push("reason is required");
  }
  if (errors.length || typeof reason !== "string") {
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
              ? "Converted leads cannot be invalidated"
              : `Cannot invalidate a ${lead.status} lead`,
        },
        { status: 409 },
      );
    }
    const updated = await transitionLead(
      client,
      lead,
      "mark_invalid",
      "invalid",
      lead.stage_id as string | null,
      { invalid_reason: reason },
      { reason },
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Lead marked invalid", lead: updated });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to mark lead invalid", error);
    return NextResponse.json(
      { error: "Unable to mark lead invalid" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
