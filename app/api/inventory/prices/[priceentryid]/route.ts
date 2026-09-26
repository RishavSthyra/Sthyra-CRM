import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  assertOnlyFields,
  isRecord,
  jsonObjectValue,
  numberValue,
  parseInventoryUuid,
} from "@/lib/inventory";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
type Context = { params: Promise<{ priceentryid: string }> };
async function accessPrice(request: NextRequest, id: string) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope;
  const result = await pool.query(
    `SELECT entry.*,book.company_id,book.project_id FROM inventory_price_book_entries entry JOIN inventory_price_books book ON book.price_book_id=entry.price_book_id WHERE entry.price_entry_id=$1`,
    [id],
  );
  if (!result.rowCount)
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Inventory price not found" },
        { status: 404 },
      ),
    };
  if (
    !canAccessOperationsEntity(
      scope.context.access,
      Number(result.rows[0].company_id),
      Number(result.rows[0].project_id),
    )
  )
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "You do not have access to this inventory price" },
        { status: 403 },
      ),
    };
  return { ok: true as const, price: result.rows[0] };
}

export async function GET(request: NextRequest, context: Context) {
  const id = parseInventoryUuid((await context.params).priceentryid);
  if (!id)
    return NextResponse.json(
      { error: "priceEntryId must be a valid UUID" },
      { status: 400 },
    );
  const access = await accessPrice(request, id);
  if (!access.ok) return access.response;
  return NextResponse.json({ price: access.price });
}

export async function PATCH(request: NextRequest, context: Context) {
  const raw = (await context.params).priceentryid;
  const id = parseInventoryUuid(raw);
  if (!id)
    return NextResponse.json(
      { error: "priceEntryId must be a valid UUID" },
      { status: 400 },
    );
  const access = await accessPrice(request, id);
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
    ["base_amount", "components", "valid_from", "valid_until"],
    errors,
  );
  const data: Record<string, unknown> = {
    base_amount: numberValue(body.base_amount, "base_amount", errors, {
      minimum: 0,
    }),
    components: jsonObjectValue(body.components, "components", errors),
  };
  for (const field of ["valid_from", "valid_until"]) {
    const value = body[field];
    if (value === undefined) data[field] = undefined;
    else if (value === null) data[field] = null;
    else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
      data[field] = value;
    else errors.push(`${field} must use YYYY-MM-DD format or be null`);
  }
  const from = (
    data.valid_from === undefined ? access.price.valid_from : data.valid_from
  ) as string | null;
  const until = (
    data.valid_until === undefined ? access.price.valid_until : data.valid_until
  ) as string | null;
  if (from && until && String(until) < String(from))
    errors.push("valid_until cannot be before valid_from");
  const fields = Object.entries(data).filter(
    ([, value]) => value !== undefined,
  );
  if (!fields.length) errors.push("At least one mutable field is required");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const updateFields: Array<[string, unknown]> = [
    ...fields,
    ["source", "manual"],
  ];
  const values = updateFields.map(([, value]) => value);
  values.push(id);
  try {
    const result = await pool.query(
      `UPDATE inventory_price_book_entries SET ${updateFields.map(([key], index) => `${key}=$${index + 1}`).join(",")},updated_at=CURRENT_TIMESTAMP WHERE price_entry_id=$${values.length} RETURNING *`,
      values,
    );
    return NextResponse.json({
      message: "Inventory price updated",
      price: result.rows[0],
    });
  } catch (error) {
    console.error("Failed to update inventory price", error);
    return NextResponse.json(
      { error: "Unable to update inventory price" },
      { status: 500 },
    );
  }
}
export async function DELETE(request: NextRequest, context: Context) {
  const id = parseInventoryUuid((await context.params).priceentryid);
  if (!id)
    return NextResponse.json(
      { error: "priceEntryId must be a valid UUID" },
      { status: 400 },
    );
  const access = await accessPrice(request, id);
  if (!access.ok) return access.response;
  try {
    await pool.query(
      "DELETE FROM inventory_price_book_entries WHERE price_entry_id=$1",
      [id],
    );
    return NextResponse.json({ message: "Inventory price removed" });
  } catch (error) {
    console.error("Failed to remove inventory price", error);
    return NextResponse.json(
      { error: "Unable to remove inventory price" },
      { status: 500 },
    );
  }
}
