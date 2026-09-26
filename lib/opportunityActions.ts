import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  addOpportunityStateHistory,
  getOpportunity,
  validStageKey,
} from "@/lib/opportunities";
import { parseUuid } from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

async function jsonObject(
  request: NextRequest,
): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return isObject(body) && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

async function optionalJsonObject(
  request: NextRequest,
): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const body = JSON.parse(text);
    return isObject(body) && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export async function changeOpportunityStage(
  request: NextRequest,
  rawOpportunityId: string,
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const opportunityId = parseUuid(rawOpportunityId);
  if (!opportunityId)
    return NextResponse.json(
      { error: "opportunityId must be a valid UUID" },
      { status: 400 },
    );
  const body = await jsonObject(request);
  if (!body)
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 },
    );
  const unknown = Object.keys(body).filter((key) => key !== "stage_key");
  if (!validStageKey(body.stage_key) || unknown.length)
    return NextResponse.json(
      {
        error: "Validation failed",
        details: [
          ...unknown.map((key) => `Unknown field: ${key}`),
          ...(!validStageKey(body.stage_key)
            ? ["stage_key must use lowercase letters, numbers, and underscores"]
            : []),
        ],
      },
      { status: 422 },
    );
  const stageKey = body.stage_key;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const opportunity = await getOpportunity(client, opportunityId, true);
    if (!opportunity) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Opportunity not found" },
        { status: 404 },
      );
    }
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(opportunity.company_id),
        Number(opportunity.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this opportunity" },
        { status: 403 },
      );
    }
    if (opportunity.status !== "open") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "Closed opportunities must be reopened before changing stage",
        },
        { status: 409 },
      );
    }
    if (opportunity.stage_key === stageKey) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Opportunity is already in this stage" },
        { status: 409 },
      );
    }
    const configuredStage = await client.query(
      `SELECT stage_key, probability
       FROM project_opportunity_stages
       WHERE project_id=$1 AND stage_key=$2 AND is_active=TRUE`,
      [opportunity.project_id, stageKey],
    );
    if (!configuredStage.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Active project opportunity stage not found" },
        { status: 422 },
      );
    }
    await addOpportunityStateHistory(
      client,
      opportunity,
      "change_stage",
      "open",
      stageKey,
      scope.context.userId,
    );
    const updated = await client.query(
      `UPDATE opportunities SET stage_key=$1, probability=$2, updated_by=$3,
       updated_at=CURRENT_TIMESTAMP WHERE opportunity_id=$4 RETURNING *`,
      [
        stageKey,
        configuredStage.rows[0].probability,
        scope.context.userId,
        opportunityId,
      ],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Opportunity stage changed",
      opportunity: updated.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to change opportunity stage", error);
    return NextResponse.json(
      { error: "Unable to change opportunity stage" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function closeOpportunity(
  request: NextRequest,
  rawOpportunityId: string,
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const opportunityId = parseUuid(rawOpportunityId);
  if (!opportunityId)
    return NextResponse.json(
      { error: "opportunityId must be a valid UUID" },
      { status: 400 },
    );
  const body = await jsonObject(request);
  if (!body)
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 },
    );
  const errors: string[] = [];
  const allowed = new Set([
    "outcome",
    "closing_reason",
    "closing_notes",
    "amount",
  ]);
  Object.keys(body)
    .filter((key) => !allowed.has(key))
    .forEach((key) => errors.push(`Unknown field: ${key}`));
  const outcome = body.outcome;
  if (outcome !== "won" && outcome !== "lost")
    errors.push("outcome must be won or lost");
  const reason = validateText(
    body.closing_reason,
    "closing_reason",
    2000,
    true,
    errors,
  );
  const notes = validateText(
    body.closing_notes,
    "closing_notes",
    10000,
    true,
    errors,
  );
  let amount: number | undefined;
  if (body.amount !== undefined) {
    if (
      typeof body.amount !== "number" ||
      !Number.isFinite(body.amount) ||
      body.amount < 0
    )
      errors.push("amount must be a non-negative number");
    else amount = body.amount;
  }
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const opportunity = await getOpportunity(client, opportunityId, true);
    if (!opportunity) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Opportunity not found" },
        { status: 404 },
      );
    }
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(opportunity.company_id),
        Number(opportunity.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this opportunity" },
        { status: 403 },
      );
    }
    if (opportunity.status !== "open") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Opportunity is already closed" },
        { status: 409 },
      );
    }
    await addOpportunityStateHistory(
      client,
      opportunity,
      "close",
      "closed",
      opportunity.stage_key as string,
      scope.context.userId,
      { outcome, closing_reason: reason ?? null },
    );
    const updated = await client.query(
      `UPDATE opportunities SET status='closed', outcome=$1,
       closing_reason=$2, closing_notes=$3, amount=COALESCE($4,amount),
       probability=CASE WHEN $1='won' THEN 100 ELSE 0 END,
       closed_at=CURRENT_TIMESTAMP, closed_by=$5, updated_by=$5,
       updated_at=CURRENT_TIMESTAMP WHERE opportunity_id=$6 RETURNING *`,
      [
        outcome,
        reason ?? null,
        notes ?? null,
        amount ?? null,
        scope.context.userId,
        opportunityId,
      ],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: `Opportunity closed as ${outcome}`,
      opportunity: updated.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to close opportunity", error);
    return NextResponse.json(
      { error: "Unable to close opportunity" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function reopenOpportunity(
  request: NextRequest,
  rawOpportunityId: string,
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const opportunityId = parseUuid(rawOpportunityId);
  if (!opportunityId)
    return NextResponse.json(
      { error: "opportunityId must be a valid UUID" },
      { status: 400 },
    );
  const body = await optionalJsonObject(request);
  if (!body)
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 },
    );
  const errors: string[] = [];
  const unknown = Object.keys(body).filter((key) => key !== "reason");
  unknown.forEach((key) => errors.push(`Unknown field: ${key}`));
  const reason = validateText(body.reason, "reason", 2000, true, errors);
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const opportunity = await getOpportunity(client, opportunityId, true);
    if (!opportunity) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Opportunity not found" },
        { status: 404 },
      );
    }
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(opportunity.company_id),
        Number(opportunity.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this opportunity" },
        { status: 403 },
      );
    }
    if (opportunity.status !== "closed") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Only closed opportunities can be reopened" },
        { status: 409 },
      );
    }
    await addOpportunityStateHistory(
      client,
      opportunity,
      "reopen",
      "open",
      opportunity.stage_key as string,
      scope.context.userId,
      { reason: reason ?? null, previous_outcome: opportunity.outcome },
    );
    const updated = await client.query(
      `UPDATE opportunities SET status='open', outcome=NULL, closing_reason=NULL,
       closing_notes=NULL, closed_at=NULL, closed_by=NULL,
       probability=CASE WHEN probability IN (0,100) THEN 25 ELSE probability END,
       updated_by=$1, updated_at=CURRENT_TIMESTAMP
       WHERE opportunity_id=$2 RETURNING *`,
      [scope.context.userId, opportunityId],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Opportunity reopened",
      opportunity: updated.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to reopen opportunity", error);
    return NextResponse.json(
      { error: "Unable to reopen opportunity" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
