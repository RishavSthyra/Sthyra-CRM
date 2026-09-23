import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { matchesConditions } from "@/lib/operations";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject } from "@/lib/projectAccess";
import { isObject } from "@/utils/isObject";

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
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
    Array.isArray(body) ||
    !Number.isSafeInteger(body.project_id) ||
    !isObject(body.record) ||
    Array.isArray(body.record)
  ) {
    return NextResponse.json(
      { error: "project_id and record object are required" },
      { status: 422 },
    );
  }
  const projectId = Number(body.project_id);
  if (!canAccessProject(scope.context.access, projectId))
    return NextResponse.json(
      { error: "You do not have access to this project" },
      { status: 403 },
    );
  const unknown = Object.keys(body).filter(
    (key) => !["project_id", "record"].includes(key),
  );
  if (unknown.length)
    return NextResponse.json(
      {
        error: "Validation failed",
        details: unknown.map((key) => `Unknown field: ${key}`),
      },
      { status: 422 },
    );
  try {
    const rules = await pool.query(
      `SELECT * FROM routing_rules
       WHERE company_id=$1 AND is_active=TRUE AND (project_id IS NULL OR project_id=$2)
       ORDER BY priority, created_at`,
      [scope.context.access.company.company_id, projectId],
    );
    const matches = rules.rows.filter((rule) =>
      matchesConditions(
        body.record as Record<string, unknown>,
        rule.conditions ?? {},
      ),
    );
    return NextResponse.json({
      matched: matches.length > 0,
      selected_rule: matches[0] ?? null,
      matches,
    });
  } catch (error) {
    console.error("Failed to test routing rules", error);
    return NextResponse.json(
      { error: "Unable to test routing rules" },
      { status: 500 },
    );
  }
}
