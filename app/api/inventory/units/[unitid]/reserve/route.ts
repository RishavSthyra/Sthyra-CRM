import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getInventoryUnit,
  isRecord,
  numberValue,
  parseInventoryUuid,
  textValue,
  uuidValue,
} from "@/lib/inventory";
import {
  changeInventoryUnitStatus,
  expireStaleInventoryHolds,
  expireStaleInventoryReservations,
  InventoryActionError,
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
  const opportunityId = uuidValue(
    body.opportunity_id,
    "opportunity_id",
    errors,
  );
  const amount = numberValue(
    body.reservation_amount,
    "reservation_amount",
    errors,
    { nullable: true, minimum: 0 },
  );
  const currency = (
    textValue(body.currency, "currency", errors, { maximum: 3 }) ?? "INR"
  ).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    errors.push("currency must be a three-letter ISO code");
  const notes = textValue(body.notes, "notes", errors, {
    nullable: true,
    maximum: 10000,
  });
  let expiresAt: string | null = null;
  if (body.expires_at !== undefined && body.expires_at !== null) {
    if (
      typeof body.expires_at !== "string" ||
      Number.isNaN(Date.parse(body.expires_at)) ||
      Date.parse(body.expires_at) <= Date.now()
    )
      errors.push("expires_at must be a future date-time or null");
    else expiresAt = new Date(body.expires_at).toISOString();
  }
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
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
    await expireStaleInventoryReservations(
      client,
      Number(unit.company_id),
      Number(unit.project_id),
    );
    unit = await getInventoryUnit(client, unitId, true);
    if (!["available", "held"].includes(String(unit.status))) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: `Only available or held inventory can be reserved; this unit is ${unit.status}`,
        },
        { status: 409 },
      );
    }
    const opportunity = await client.query(
      "SELECT opportunity_id,lead_id FROM opportunities WHERE opportunity_id=$1 AND company_id=$2 AND project_id=$3 AND status='open'",
      [opportunityId, unit.company_id, unit.project_id],
    );
    if (!opportunity.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Open opportunity not found in this project" },
        { status: 422 },
      );
    }
    let holdId: null | string = null;
    if (unit.status === "held") {
      const hold = await client.query(
        "SELECT * FROM inventory_holds WHERE unit_id=$1 AND status='active' FOR UPDATE",
        [unitId],
      );
      if (!hold.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "The held unit has no active hold" },
          { status: 409 },
        );
      }
      if (
        hold.rows[0].opportunity_id !== opportunityId &&
        hold.rows[0].lead_id !== opportunity.rows[0].lead_id
      ) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            error: "The active hold belongs to a different lead or opportunity",
          },
          { status: 409 },
        );
      }
      holdId = hold.rows[0].hold_id;
      await client.query(
        "UPDATE inventory_holds SET status='converted',released_at=CURRENT_TIMESTAMP,released_by=$2,updated_at=CURRENT_TIMESTAMP WHERE hold_id=$1",
        [holdId, scope.context.userId],
      );
    }
    const reservation = await client.query(
      `INSERT INTO inventory_reservations (company_id,project_id,unit_id,opportunity_id,hold_id,reservation_amount,currency,expires_at,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        unit.company_id,
        unit.project_id,
        unitId,
        opportunityId,
        holdId,
        amount ?? null,
        currency,
        expiresAt,
        notes ?? null,
        scope.context.userId,
      ],
    );
    await changeInventoryUnitStatus(client, {
      unitId,
      companyId: Number(unit.company_id),
      projectId: Number(unit.project_id),
      toStatus: "reserved",
      userId: scope.context.userId,
      reason: "Unit reserved",
      metadata: {
        reservation_id: reservation.rows[0].reservation_id,
        opportunity_id: opportunityId,
        hold_id: holdId,
      },
    });
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Inventory unit reserved", reservation: reservation.rows[0] },
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
        { error: "This inventory unit already has an active reservation" },
        { status: 409 },
      );
    console.error("Failed to reserve inventory unit", error);
    return NextResponse.json(
      { error: "Unable to reserve inventory unit" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
