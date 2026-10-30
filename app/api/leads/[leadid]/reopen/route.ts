import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getProjectStage, lockLead, transitionLead } from "@/lib/leadCommands";
import { ensureReopenedLeadCall } from "@/lib/leadFollowUps";
import { parseLeadId } from "@/lib/leads";
import {
  canUpdateLead,
  requireLeadVisibility,
} from "@/lib/leadVisibility";
import { isObject } from "@/utils/isObject";

type Context = { params: Promise<{ leadid: string }> };
export async function POST(request: NextRequest, context: Context) {
  const scope = await requireLeadVisibility(request, "LEADS_UPDATE");
  if (!scope.ok) return scope.response;
  const leadId = parseLeadId((await context.params).leadid);
  if (!leadId) {
    return NextResponse.json(
      { error: "leadId must be a valid UUID" },
      { status: 400 },
    );
  }
  if (!(await canUpdateLead(leadId, scope.context.leadVisibility))) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
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
  if (
    !isObject(body) ||
    Array.isArray(body) ||
    (body.stage_key !== undefined && typeof body.stage_key !== "string")
  ) {
    return NextResponse.json(
      { error: "stage_key must be a string when provided" },
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
      !["closed", "duplicate", "nurture", "invalid"].includes(
        lead.status as string,
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `Cannot reopen a ${lead.status} lead` },
        { status: 409 },
      );
    }
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
          "SELECT stage_id, stage_key, stage_name, is_terminal FROM project_lead_stages WHERE project_id=$1 AND is_active=TRUE AND is_initial=TRUE",
          [lead.project_id],
        )
      ).rows[0];
    }
    if (!stage || stage.is_terminal) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Valid non-terminal reopen stage not found" },
        { status: 422 },
      );
    }
    const updated = await transitionLead(
      client,
      lead,
      "reopen",
      "active",
      stage.stage_id,
      {
        closing_reason_id: null,
        closing_notes: null,
        closed_at: null,
        duplicate_of_lead_id: null,
        invalid_reason: null,
        nurture_reason: null,
        nurture_until: null,
      },
      { stage_key: stage.stage_key },
      scope.context.userId,
    );
    await ensureReopenedLeadCall(client, updated, scope.context.userId);
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Lead reopened",
      lead: updated,
      stage: {
        stage_id: stage.stage_id,
        stage_key: stage.stage_key,
        stage_name: stage.stage_name ?? null,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to reopen lead", error);
    return NextResponse.json(
      { error: "Unable to reopen lead" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
