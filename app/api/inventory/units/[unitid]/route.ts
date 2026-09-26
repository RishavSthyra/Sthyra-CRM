import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  assertOnlyFields,
  getInventoryUnit,
  inventoryDatabaseError,
  isRecord,
  jsonObjectValue,
  numberValue,
  parseInventoryUuid,
  textValue,
  uuidValue,
  validateCatalogReferences,
} from "@/lib/inventory";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";

type Context = { params: Promise<{ unitid: string }> };
async function accessUnit(request: NextRequest, raw: string) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope;
  const id = parseInventoryUuid(raw);
  if (!id)
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "unitId must be a valid UUID" },
        { status: 400 },
      ),
    };
  const unit = await getInventoryUnit(pool, id);
  if (!unit)
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Inventory unit not found" },
        { status: 404 },
      ),
    };
  if (
    !canAccessOperationsEntity(
      scope.context.access,
      Number(unit.company_id),
      Number(unit.project_id),
    )
  )
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "You do not have access to this inventory unit" },
        { status: 403 },
      ),
    };
  return { ok: true as const, context: scope.context, unitId: id, unit };
}

export async function GET(request: NextRequest, context: Context) {
  const access = await accessUnit(request, (await context.params).unitid);
  if (!access.ok) return access.response;
  try {
    const [plans, prices, hold, reservation] = await Promise.all([
      pool.query(
        `SELECT fp.*,link.plan_role,link.display_order,COALESCE(jsonb_agg(jsonb_build_object('asset_id',a.asset_id,'asset_kind',a.asset_kind,'asset_url',a.asset_url,'file_name',a.file_name,'mime_type',a.mime_type) ORDER BY a.display_order) FILTER(WHERE a.asset_id IS NOT NULL),'[]'::jsonb) AS assets FROM inventory_unit_type_floor_plans link JOIN inventory_floor_plans fp ON fp.floor_plan_id=link.floor_plan_id LEFT JOIN inventory_floor_plan_assets a ON a.floor_plan_id=fp.floor_plan_id WHERE link.unit_type_id=$1 GROUP BY fp.floor_plan_id,link.plan_role,link.display_order ORDER BY link.display_order`,
        [access.unit.unit_type_id],
      ),
      pool.query(
        `SELECT entry.*,book.price_book_name,book.currency FROM inventory_price_book_entries entry JOIN inventory_price_books book ON book.price_book_id=entry.price_book_id WHERE book.is_active=TRUE AND (entry.unit_id=$1 OR (entry.unit_type_id=$2 AND entry.unit_id IS NULL)) AND (entry.valid_from IS NULL OR entry.valid_from<=CURRENT_DATE) AND (entry.valid_until IS NULL OR entry.valid_until>=CURRENT_DATE) ORDER BY entry.unit_id NULLS LAST,book.is_default DESC,entry.valid_from DESC NULLS LAST`,
        [access.unitId, access.unit.unit_type_id],
      ),
      pool.query(
        "SELECT * FROM inventory_holds WHERE unit_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1",
        [access.unitId],
      ),
      pool.query(
        "SELECT * FROM inventory_reservations WHERE unit_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1",
        [access.unitId],
      ),
    ]);
    return NextResponse.json({
      unit: {
        ...access.unit,
        floor_plans: plans.rows,
        prices: prices.rows,
        active_hold: hold.rows[0] ?? null,
        active_reservation: reservation.rows[0] ?? null,
      },
    });
  } catch (error) {
    console.error("Failed to retrieve inventory unit", error);
    return NextResponse.json(
      { error: "Unable to retrieve inventory unit" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const access = await accessUnit(request, (await context.params).unitid);
  if (!access.ok) return access.response;
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
  assertOnlyFields(
    body,
    [
      "node_id",
      "unit_type_id",
      "unit_code",
      "unit_name",
      "external_unit_key",
      "orientation",
      "area_sqft",
      "price_override",
      "currency",
      "metadata",
      "version",
    ],
    errors,
  );
  const data: Record<string, unknown> = {
    node_id: uuidValue(body.node_id, "node_id", errors, true),
    unit_type_id: uuidValue(body.unit_type_id, "unit_type_id", errors, true),
    unit_code: textValue(body.unit_code, "unit_code", errors, { maximum: 100 }),
    unit_name: textValue(body.unit_name, "unit_name", errors, {
      nullable: true,
      maximum: 200,
    }),
    external_unit_key: textValue(
      body.external_unit_key,
      "external_unit_key",
      errors,
      { nullable: true, maximum: 200 },
    ),
    orientation: textValue(body.orientation, "orientation", errors, {
      nullable: true,
      maximum: 100,
    }),
    area_sqft: numberValue(body.area_sqft, "area_sqft", errors, {
      nullable: true,
      minimum: 0.01,
    }),
    price_override: numberValue(body.price_override, "price_override", errors, {
      nullable: true,
      minimum: 0,
    }),
    metadata: jsonObjectValue(body.metadata, "metadata", errors),
  };
  if (body.currency !== undefined) {
    const currency = textValue(body.currency, "currency", errors, {
      maximum: 3,
    })?.toUpperCase();
    if (currency && !/^[A-Z]{3}$/.test(currency))
      errors.push("currency must be a three-letter ISO code");
    data.currency = currency;
  }
  const expectedVersion = numberValue(body.version, "version", errors, {
    minimum: 1,
    integer: true,
  });
  if (!Object.keys(body).some((key) => key !== "version"))
    errors.push("At least one mutable field is required");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const referenceErrors = await validateCatalogReferences(
      client,
      access.context.access.company.company_id,
      Number(access.unit.project_id),
      {
        nodeId: data.node_id as string | null | undefined,
        unitTypeId: data.unit_type_id as string | null | undefined,
      },
    );
    if (referenceErrors.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Validation failed", details: referenceErrors },
        { status: 422 },
      );
    }
    delete data.version;
    const fields = Object.entries(data).filter(
      ([, value]) => value !== undefined,
    );
    const values = fields.map(([, value]) => value);
    values.push(access.unitId, expectedVersion ?? Number(access.unit.version));
    const result = await client.query(
      `UPDATE inventory_units SET ${fields.map(([key], index) => `${key}=$${index + 1}`).join(",")},version=version+1,updated_at=CURRENT_TIMESTAMP WHERE unit_id=$${values.length - 1} AND version=$${values.length} RETURNING *`,
      values,
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            "Inventory unit was updated by another request; reload and retry",
        },
        { status: 409 },
      );
    }
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Inventory unit updated",
      unit: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (inventoryDatabaseError(error) === "23505")
      return NextResponse.json(
        {
          error:
            "A unit with this code or external key already exists in the project",
        },
        { status: 409 },
      );
    console.error("Failed to update inventory unit", error);
    return NextResponse.json(
      { error: "Unable to update inventory unit" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const access = await accessUnit(request, (await context.params).unitid);
  if (!access.ok) return access.response;
  if (
    !["available", "unavailable", "blocked"].includes(
      String(access.unit.status),
    )
  )
    return NextResponse.json(
      { error: `A ${access.unit.status} unit cannot be archived` },
      { status: 409 },
    );
  try {
    const result = await pool.query(
      "UPDATE inventory_units SET archived_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE unit_id=$1 AND archived_at IS NULL RETURNING unit_id",
      [access.unitId],
    );
    if (!result.rowCount)
      return NextResponse.json(
        { error: "Inventory unit is already archived" },
        { status: 409 },
      );
    return NextResponse.json({ message: "Inventory unit archived" });
  } catch (error) {
    console.error("Failed to archive inventory unit", error);
    return NextResponse.json(
      { error: "Unable to archive inventory unit" },
      { status: 500 },
    );
  }
}
