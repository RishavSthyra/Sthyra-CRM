import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseUuid } from "@/lib/operations";
import { requireOperationsContext } from "@/lib/operationsAccess";

export async function setSlaRuleActive(
  request: NextRequest,
  rawRuleId: string,
  active: boolean,
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects)
    return NextResponse.json(
      { error: "Administrator access is required" },
      { status: 403 },
    );
  const ruleId = parseUuid(rawRuleId);
  if (!ruleId)
    return NextResponse.json(
      { error: "slaRuleId must be a valid UUID" },
      { status: 400 },
    );
  try {
    const result = await pool.query(
      `UPDATE sla_rules SET is_active=$1, updated_at=CURRENT_TIMESTAMP
       WHERE sla_rule_id=$2 AND company_id=$3 RETURNING *`,
      [active, ruleId, scope.context.access.company.company_id],
    );
    if (!result.rowCount)
      return NextResponse.json(
        { error: "SLA rule not found" },
        { status: 404 },
      );
    return NextResponse.json({
      message: `SLA rule ${active ? "activated" : "deactivated"}`,
      rule: result.rows[0],
    });
  } catch (error) {
    console.error("Failed to change SLA rule state", error);
    return NextResponse.json(
      { error: "Unable to change SLA rule state" },
      { status: 500 },
    );
  }
}
