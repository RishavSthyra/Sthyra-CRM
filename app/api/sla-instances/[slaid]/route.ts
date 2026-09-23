import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  markOverdueSlaInstances,
  parseUuid,
  SLA_INSTANCE_COLUMNS,
} from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";

type Context = { params: Promise<{ slaid: string }> };

export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const slaId = parseUuid((await context.params).slaid);
  if (!slaId) {
    return NextResponse.json(
      { error: "slaId must be a valid UUID" },
      { status: 400 },
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await markOverdueSlaInstances(
      client,
      scope.context.access.company.company_id,
    );
    const result = await client.query(
      `SELECT ${SLA_INSTANCE_COLUMNS}, s.rule_name, s.description AS rule_description,
        s.applies_to, s.conditions, s.response_minutes, s.resolution_minutes,
        s.escalation_minutes, p.project_name,
        c.first_name, c.last_name, c.email, c.phone_number
       FROM sla_instances i
       JOIN sla_rules s ON s.sla_rule_id=i.sla_rule_id
       JOIN projects p ON p.project_id=i.project_id
       LEFT JOIN leads l ON l.lead_id=COALESCE(i.lead_id,
         (SELECT a.lead_id FROM assignments a WHERE a.assignment_id=i.assignment_id))
       LEFT JOIN contacts c ON c.contact_id=l.contact_id
       WHERE i.sla_id=$1`,
      [slaId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "SLA instance not found" },
        { status: 404 },
      );
    }
    const sla = result.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(sla.company_id),
        Number(sla.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this SLA instance" },
        { status: 403 },
      );
    }
    const history = await client.query(
      `SELECT h.*, u.first_name AS performed_by_first_name,
        u.last_name AS performed_by_last_name
       FROM sla_instance_history h
       LEFT JOIN users u ON u.user_id=h.performed_by
       WHERE h.sla_id=$1
       ORDER BY h.created_at DESC, h.history_id DESC`,
      [slaId],
    );
    await client.query("COMMIT");
    return NextResponse.json({ sla, history: history.rows });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to retrieve SLA instance", error);
    return NextResponse.json(
      { error: "Unable to retrieve SLA instance" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
