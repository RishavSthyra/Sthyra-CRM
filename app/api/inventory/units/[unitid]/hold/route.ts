import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getInventoryUnit,
  isRecord,
  parseInventoryUuid,
  textValue,
  uuidValue,
} from "@/lib/inventory";
import {
  expireStaleInventoryHolds,
  InventoryActionError,
  changeInventoryUnitStatus,
} from "@/lib/inventoryActions";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";

type Context = { params: Promise<{ unitid: string }> };
export async function POST(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const unitId = parseInventoryUuid((await context.params).unitid);
  if (!unitId)
    return NextResponse.json(
      { error: "unitId must be a valid UUID" },
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
  if (!isRecord(body))
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 422 },
    );
  const errors: string[] = [];
  const leadId = uuidValue(body.lead_id, "lead_id", errors, true);
  const opportunityId = uuidValue(
    body.opportunity_id,
    "opportunity_id",
    errors,
    true,
  );
  if (!leadId && !opportunityId)
    errors.push("lead_id or opportunity_id is required");
  const reason = textValue(body.reason, "reason", errors, {
    nullable: true,
    maximum: 5000,
  });
  const expiresAt =
    typeof body.expires_at === "string" &&
    !Number.isNaN(Date.parse(body.expires_at))
      ? new Date(body.expires_at)
      : null;
  if (!expiresAt || expiresAt.getTime() <= Date.now())
    errors.push("expires_at must be a future date-time");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const expiresIso = expiresAt!.toISOString();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let unit = await getInventoryUnit(client, unitId, true);
    if (!unit) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Inventory unit not found" },
        { status: 404 },
      );
    }
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(unit.company_id),
        Number(unit.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this inventory unit" },
        { status: 403 },
      );
    }
    await expireStaleInventoryHolds(
      client,
      Number(unit.company_id),
      Number(unit.project_id),
    );
    unit = await getInventoryUnit(client, unitId, true);
    const reference = await client.query(
      `SELECT l.lead_id,o.opportunity_id,COALESCE(o.lead_id,l.lead_id) AS resolved_lead_id,o.lead_id AS opportunity_lead_id FROM (SELECT $1::uuid AS lead_id) input LEFT JOIN leads l ON l.lead_id=input.lead_id AND l.project_id=$3 LEFT JOIN opportunities o ON o.opportunity_id=$2 AND o.project_id=$3 AND o.company_id=$4`,
      [leadId ?? null, opportunityId ?? null, unit.project_id, unit.company_id],
    );
    if (
      (leadId && !reference.rows[0]?.lead_id) ||
      (opportunityId && !reference.rows[0]?.opportunity_id) ||
      (leadId &&
        opportunityId &&
        reference.rows[0]?.opportunity_lead_id !== leadId)
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            "Lead and opportunity must belong to the inventory project and refer to the same customer",
        },
        { status: 422 },
      );
    }
    if (unit.status !== "available") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: `Only available inventory can be held; this unit is ${unit.status}`,
        },
        { status: 409 },
      );
    }
    const hold = await client.query(
      `INSERT INTO inventory_holds (company_id,project_id,unit_id,lead_id,opportunity_id,reason,expires_at,created_by) VALUES ($1,$2,$3,COALESCE($4,$5),$6,$7,$8,$9) RETURNING *`,
      [
        unit.company_id,
        unit.project_id,
        unitId,
        leadId ?? null,
        reference.rows[0]?.resolved_lead_id ?? null,
        opportunityId ?? null,
        reason ?? null,
        expiresIso,
        scope.context.userId,
      ],
    );
    await changeInventoryUnitStatus(client, {
      unitId,
      companyId: Number(unit.company_id),
      projectId: Number(unit.project_id),
      toStatus: "held",
      userId: scope.context.userId,
      reason: reason ?? "Unit placed on hold",
      metadata: { hold_id: hold.rows[0].hold_id, expires_at: expiresIso },
    });
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Inventory unit held", hold: hold.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof InventoryActionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    )
      return NextResponse.json(
        { error: "This inventory unit already has an active hold" },
        { status: 409 },
      );
    console.error("Failed to hold inventory unit", error);
    return NextResponse.json(
      { error: "Unable to hold inventory unit" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
