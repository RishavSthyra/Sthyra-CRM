import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  assertOnlyFields,
  booleanValue,
  inventoryDatabaseError,
  isRecord,
  jsonObjectValue,
  numberValue,
  parseInventoryUuid,
  textValue,
  uuidValue,
  validateCatalogReferences,
  validateInventoryAttributeValues,
} from "@/lib/inventory";
import { requireOperationsContext } from "@/lib/operationsAccess";
import {
  syncUnitTypeBasePrice,
  type PricingSyncResult,
} from "@/lib/inventoryPricing";

type Context = { params: Promise<{ unittypeid: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const id = parseInventoryUuid((await context.params).unittypeid);
  if (!id)
    return NextResponse.json(
      { error: "unitTypeId must be a valid UUID" },
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
  assertOnlyFields(
    body,
    [
      "asset_type_id",
      "type_code",
      "type_name",
      "configuration",
      "bedrooms",
      "bathrooms",
      "balconies",
      "carpet_area_sqft",
      "built_up_area_sqft",
      "saleable_area_sqft",
      "base_price",
      "currency",
      "specifications",
      "floor_plan_id",
      "is_active",
    ],
    errors,
  );
  const data: Record<string, unknown> = {
    asset_type_id: uuidValue(body.asset_type_id, "asset_type_id", errors),
    type_code: textValue(body.type_code, "type_code", errors, { maximum: 100 }),
    type_name: textValue(body.type_name, "type_name", errors, { maximum: 200 }),
    configuration: textValue(body.configuration, "configuration", errors, {
      nullable: true,
      maximum: 100,
    }),
    specifications: jsonObjectValue(
      body.specifications,
      "specifications",
      errors,
    ),
    is_active: booleanValue(body.is_active, "is_active", errors),
  };
  for (const field of ["bedrooms", "bathrooms", "balconies"])
    data[field] = numberValue(body[field], field, errors, {
      nullable: true,
      minimum: 0,
    });
  for (const field of [
    "carpet_area_sqft",
    "built_up_area_sqft",
    "saleable_area_sqft",
  ])
    data[field] = numberValue(body[field], field, errors, {
      nullable: true,
      minimum: 0.01,
    });
  data.base_price = numberValue(body.base_price, "base_price", errors, {
    nullable: true,
    minimum: 0,
  });
  if (body.currency !== undefined) {
    const currency = textValue(body.currency, "currency", errors, {
      maximum: 3,
    })?.toUpperCase();
    if (currency && !/^[A-Z]{3}$/.test(currency))
      errors.push("currency must be a three-letter ISO code");
    data.currency = currency;
  }
  const floorPlanId = uuidValue(
    body.floor_plan_id,
    "floor_plan_id",
    errors,
    true,
  );
  if (!Object.keys(body).length) errors.push("At least one field is required");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT * FROM inventory_unit_types WHERE unit_type_id=$1 AND company_id=$2 FOR UPDATE",
      [id, scope.context.access.company.company_id],
    );
    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Inventory unit type not found" },
        { status: 404 },
      );
    }
    const referenceErrors = await validateCatalogReferences(
      client,
      scope.context.access.company.company_id,
      Number(existing.rows[0].project_id),
      {
        assetTypeId: data.asset_type_id as string | undefined,
        floorPlanId: floorPlanId ?? undefined,
      },
    );
    if (referenceErrors.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Validation failed", details: referenceErrors },
        { status: 422 },
      );
    }
    if (data.specifications !== undefined) {
      const attributeErrors = await validateInventoryAttributeValues(
        client,
        Number(existing.rows[0].project_id),
        "unit_type",
        data.specifications as Record<string, unknown>,
      );
      if (attributeErrors.length) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Validation failed", details: attributeErrors },
          { status: 422 },
        );
      }
    }
    const fields = Object.entries(data).filter(
      ([, value]) => value !== undefined,
    );
    let updated = existing.rows[0];
    if (fields.length) {
      const values = fields.map(([, value]) => value);
      values.push(id);
      const result = await client.query(
        `UPDATE inventory_unit_types SET ${fields.map(([key], index) => `${key}=$${index + 1}`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE unit_type_id=$${values.length} RETURNING *`,
        values,
      );
      updated = result.rows[0];
    }
    if (body.floor_plan_id !== undefined) {
      await client.query(
        "DELETE FROM inventory_unit_type_floor_plans WHERE unit_type_id=$1 AND plan_role='primary'",
        [id],
      );
      if (floorPlanId)
        await client.query(
          "INSERT INTO inventory_unit_type_floor_plans (unit_type_id,floor_plan_id,plan_role) VALUES ($1,$2,'primary') ON CONFLICT (unit_type_id,floor_plan_id) DO UPDATE SET plan_role='primary'",
          [id, floorPlanId],
        );
    }
    let pricingSync: PricingSyncResult | undefined;
    if (body.base_price !== undefined || body.currency !== undefined) {
      pricingSync = await syncUnitTypeBasePrice(client, updated);
    }
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Inventory unit type updated",
      unit_type: updated,
      ...(pricingSync ? { pricing_sync: pricingSync } : {}),
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (inventoryDatabaseError(error) === "23505")
      return NextResponse.json(
        { error: "A unit type with this code already exists in the project" },
        { status: 409 },
      );
    console.error("Failed to update inventory unit type", error);
    return NextResponse.json(
      { error: "Unable to update inventory unit type" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
