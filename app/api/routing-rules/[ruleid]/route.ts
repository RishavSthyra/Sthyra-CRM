import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { OperationsReferenceError } from "@/lib/assignmentService";
import {
  parseUuid,
  ROUTING_RULE_COLUMNS,
  RoutingRuleInput,
  validateRoutingRulePayload,
} from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { validateRoutingReferences } from "@/lib/routingService";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";

type Context = { params: Promise<{ ruleid: string }> };
export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const ruleId = parseUuid((await context.params).ruleid);
  if (!ruleId)
    return NextResponse.json(
      { error: "ruleId must be a valid UUID" },
      { status: 400 },
    );
  try {
    const result = await pool.query(
      `SELECT ${ROUTING_RULE_COLUMNS} FROM routing_rules r WHERE r.rule_id=$1`,
      [ruleId],
    );
    if (!result.rowCount)
      return NextResponse.json(
        { error: "Routing rule not found" },
        { status: 404 },
      );
    const rule = result.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(rule.company_id),
        rule.project_id === null ? null : Number(rule.project_id),
      )
    )
      return NextResponse.json(
        { error: "You do not have access to this routing rule" },
        { status: 403 },
      );
    return NextResponse.json({ rule });
  } catch (error) {
    console.error("Failed to retrieve routing rule", error);
    return NextResponse.json(
      { error: "Unable to retrieve routing rule" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects)
    return NextResponse.json(
      { error: "Administrator access is required to update routing rules" },
      { status: 403 },
    );
  const ruleId = parseUuid((await context.params).ruleid);
  if (!ruleId)
    return NextResponse.json(
      { error: "ruleId must be a valid UUID" },
      { status: 400 },
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const partial = validateRoutingRulePayload(body, true);
  if (!partial.ok)
    return NextResponse.json(
      { error: "Validation failed", details: partial.errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT * FROM routing_rules WHERE rule_id=$1 FOR UPDATE",
      [ruleId],
    );
    if (!currentResult.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Routing rule not found" },
        { status: 404 },
      );
    }
    const current = currentResult.rows[0];
    if (
      Number(current.company_id) !== scope.context.access.company.company_id
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this routing rule" },
        { status: 403 },
      );
    }
    const merged = {
      project_id:
        partial.data.project_id !== undefined
          ? partial.data.project_id
          : current.project_id,
      rule_name: partial.data.rule_name ?? current.rule_name,
      description:
        partial.data.description !== undefined
          ? partial.data.description
          : current.description,
      priority: partial.data.priority ?? current.priority,
      conditions: partial.data.conditions ?? current.conditions,
      action_type: partial.data.action_type ?? current.action_type,
      target_queue_id:
        partial.data.target_queue_id !== undefined
          ? partial.data.target_queue_id
          : current.target_queue_id,
      target_user_id:
        partial.data.target_user_id !== undefined
          ? partial.data.target_user_id
          : current.target_user_id,
      target_team_id:
        partial.data.target_team_id !== undefined
          ? partial.data.target_team_id
          : current.target_team_id,
    };
    const complete = validateRoutingRulePayload(merged, false);
    if (!complete.ok) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Validation failed", details: complete.errors },
        { status: 422 },
      );
    }
    await validateRoutingReferences(
      client,
      scope.context.access.company.company_id,
      complete.data,
    );
    const fields: (keyof RoutingRuleInput)[] = [
      "project_id",
      "rule_name",
      "description",
      "priority",
      "conditions",
      "action_type",
      "target_queue_id",
      "target_user_id",
      "target_team_id",
    ];
    const updates = fields.filter((field) => partial.data[field] !== undefined);
    const values = updates.map((field) =>
      field === "conditions"
        ? JSON.stringify(partial.data[field])
        : partial.data[field],
    );
    values.push(ruleId);
    const assignments = updates.map(
      (field, index) =>
        `${field}=$${index + 1}${field === "conditions" ? "::jsonb" : ""}`,
    );
    const result = await client.query(
      `UPDATE routing_rules SET ${assignments.join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE rule_id=$${values.length} RETURNING *`,
      values,
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Routing rule updated",
      rule: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof OperationsReferenceError)
      return NextResponse.json({ error: error.message }, { status: 422 });
    if (getDatabaseErrorCode(error) === "23505")
      return NextResponse.json(
        { error: "A routing rule with this name already exists" },
        { status: 409 },
      );
    console.error("Failed to update routing rule", error);
    return NextResponse.json(
      { error: "Unable to update routing rule" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
