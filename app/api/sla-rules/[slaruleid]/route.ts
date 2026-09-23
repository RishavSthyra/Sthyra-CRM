import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  parseUuid,
  SLA_RULE_COLUMNS,
  SlaRuleInput,
  validateSlaRulePayload,
} from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { canAccessProject } from "@/lib/projectAccess";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";

type Context = { params: Promise<{ slaruleid: string }> };
export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const ruleId = parseUuid((await context.params).slaruleid);
  if (!ruleId)
    return NextResponse.json(
      { error: "slaRuleId must be a valid UUID" },
      { status: 400 },
    );
  try {
    const result = await pool.query(
      `SELECT ${SLA_RULE_COLUMNS} FROM sla_rules s WHERE s.sla_rule_id=$1`,
      [ruleId],
    );
    if (!result.rowCount)
      return NextResponse.json(
        { error: "SLA rule not found" },
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
        { error: "You do not have access to this SLA rule" },
        { status: 403 },
      );
    return NextResponse.json({ rule });
  } catch (error) {
    console.error("Failed to retrieve SLA rule", error);
    return NextResponse.json(
      { error: "Unable to retrieve SLA rule" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects)
    return NextResponse.json(
      { error: "Administrator access is required to update SLA rules" },
      { status: 403 },
    );
  const ruleId = parseUuid((await context.params).slaruleid);
  if (!ruleId)
    return NextResponse.json(
      { error: "slaRuleId must be a valid UUID" },
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
  const partial = validateSlaRulePayload(body, true);
  if (!partial.ok)
    return NextResponse.json(
      { error: "Validation failed", details: partial.errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT * FROM sla_rules WHERE sla_rule_id=$1 FOR UPDATE",
      [ruleId],
    );
    if (!currentResult.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "SLA rule not found" },
        { status: 404 },
      );
    }
    const current = currentResult.rows[0];
    if (
      Number(current.company_id) !== scope.context.access.company.company_id
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this SLA rule" },
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
      applies_to: partial.data.applies_to ?? current.applies_to,
      priority: partial.data.priority ?? current.priority,
      conditions: partial.data.conditions ?? current.conditions,
      response_minutes:
        partial.data.response_minutes !== undefined
          ? partial.data.response_minutes
          : current.response_minutes,
      resolution_minutes:
        partial.data.resolution_minutes !== undefined
          ? partial.data.resolution_minutes
          : current.resolution_minutes,
      escalation_minutes:
        partial.data.escalation_minutes !== undefined
          ? partial.data.escalation_minutes
          : current.escalation_minutes,
    };
    const complete = validateSlaRulePayload(merged, false);
    if (!complete.ok) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Validation failed", details: complete.errors },
        { status: 422 },
      );
    }
    if (
      complete.data.project_id &&
      !canAccessProject(scope.context.access, complete.data.project_id)
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Active company project not found" },
        { status: 422 },
      );
    }
    const fields: (keyof SlaRuleInput)[] = [
      "project_id",
      "rule_name",
      "description",
      "applies_to",
      "priority",
      "conditions",
      "response_minutes",
      "resolution_minutes",
      "escalation_minutes",
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
      `UPDATE sla_rules SET ${assignments.join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE sla_rule_id=$${values.length} RETURNING *`,
      values,
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "SLA rule updated",
      rule: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (getDatabaseErrorCode(error) === "23505")
      return NextResponse.json(
        { error: "An SLA rule with this name already exists" },
        { status: 409 },
      );
    console.error("Failed to update SLA rule", error);
    return NextResponse.json(
      { error: "Unable to update SLA rule" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
