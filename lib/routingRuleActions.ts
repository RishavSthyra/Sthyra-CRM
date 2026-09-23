import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseUuid } from "@/lib/operations";
import { requireOperationsContext } from "@/lib/operationsAccess";

export async function setRoutingRuleActive(
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
      { error: "ruleId must be a valid UUID" },
      { status: 400 },
    );
  try {
    const result = await pool.query(
      `UPDATE routing_rules SET is_active=$1, updated_at=CURRENT_TIMESTAMP
       WHERE rule_id=$2 AND company_id=$3 RETURNING *`,
      [active, ruleId, scope.context.access.company.company_id],
    );
    if (!result.rowCount)
      return NextResponse.json(
        { error: "Routing rule not found" },
        { status: 404 },
      );
    return NextResponse.json({
      message: `Routing rule ${active ? "activated" : "deactivated"}`,
      rule: result.rows[0],
    });
  } catch (error) {
    console.error("Failed to change routing rule state", error);
    return NextResponse.json(
      { error: "Unable to change routing rule state" },
      { status: 500 },
    );
  }
}
