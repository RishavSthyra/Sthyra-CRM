import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  assertOnlyFields,
  booleanValue,
  inventoryDatabaseError,
  isRecord,
  parseInventoryUuid,
  textValue,
} from "@/lib/inventory";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { syncProjectBasePrices } from "@/lib/inventoryPricing";
type Context = { params: Promise<{ pricebookid: string }> };
function dateValue(value: unknown, field: string, errors: string[]) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push(`${field} must use YYYY-MM-DD format or be null`);
    return undefined;
  }
  return value;
}

export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const id = parseInventoryUuid((await context.params).pricebookid);
  if (!id)
    return NextResponse.json(
      { error: "priceBookId must be a valid UUID" },
      { status: 400 },
    );
  try {
    const result = await pool.query(
      `SELECT book.*,COUNT(entry.price_entry_id)::integer AS entry_count
       FROM inventory_price_books book
       LEFT JOIN inventory_price_book_entries entry
         ON entry.price_book_id=book.price_book_id
       WHERE book.price_book_id=$1
       GROUP BY book.price_book_id`,
      [id],
    );
    if (!result.rowCount)
      return NextResponse.json(
        { error: "Price book not found" },
        { status: 404 },
      );
    const book = result.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(book.company_id),
        Number(book.project_id),
      )
    )
      return NextResponse.json(
        { error: "You do not have access to this price book" },
        { status: 403 },
      );
    return NextResponse.json({ price_book: book });
  } catch (error) {
    console.error("Failed to retrieve price book", error);
    return NextResponse.json(
      { error: "Unable to retrieve price book" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const id = parseInventoryUuid((await context.params).pricebookid);
  if (!id)
    return NextResponse.json(
      { error: "priceBookId must be a valid UUID" },
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
      "price_book_code",
      "price_book_name",
      "currency",
      "valid_from",
      "valid_until",
      "is_default",
      "is_active",
    ],
    errors,
  );
  const data: Record<string, unknown> = {
    price_book_code: textValue(
      body.price_book_code,
      "price_book_code",
      errors,
      { maximum: 100 },
    ),
    price_book_name: textValue(
      body.price_book_name,
      "price_book_name",
      errors,
      { maximum: 200 },
    ),
    valid_from: dateValue(body.valid_from, "valid_from", errors),
    valid_until: dateValue(body.valid_until, "valid_until", errors),
    is_default: booleanValue(body.is_default, "is_default", errors),
    is_active: booleanValue(body.is_active, "is_active", errors),
  };
  if (body.currency !== undefined) {
    const currency = textValue(body.currency, "currency", errors, {
      maximum: 3,
    })?.toUpperCase();
    if (currency && !/^[A-Z]{3}$/.test(currency))
      errors.push("currency must be a three-letter ISO code");
    data.currency = currency;
  }
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
      "SELECT * FROM inventory_price_books WHERE price_book_id=$1 FOR UPDATE",
      [id],
    );
    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Price book not found" },
        { status: 404 },
      );
    }
    const book = existing.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(book.company_id),
        Number(book.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this price book" },
        { status: 403 },
      );
    }
    const from = (
      data.valid_from === undefined ? book.valid_from : data.valid_from
    ) as string | null;
    const until = (
      data.valid_until === undefined ? book.valid_until : data.valid_until
    ) as string | null;
    if (from && until && String(until) < String(from)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "valid_until cannot be before valid_from" },
        { status: 422 },
      );
    }
    if (data.currency && data.currency !== book.currency) {
      const entries = await client.query(
        "SELECT 1 FROM inventory_price_book_entries WHERE price_book_id=$1 LIMIT 1",
        [id],
      );
      if (entries.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            error:
              "Currency cannot be changed after prices have been added; create another price book instead",
          },
          { status: 409 },
        );
      }
    }
    if (data.is_default === true)
      await client.query(
        "UPDATE inventory_price_books SET is_default=FALSE,updated_at=CURRENT_TIMESTAMP WHERE project_id=$1 AND price_book_id<>$2 AND is_default=TRUE",
        [book.project_id, id],
      );
    if (data.is_active === false) data.is_default = false;
    const fields = Object.entries(data).filter(
      ([, value]) => value !== undefined,
    );
    const values = fields.map(([, value]) => value);
    values.push(id);
    const result = await client.query(
      `UPDATE inventory_price_books SET ${fields.map(([key], index) => `${key}=$${index + 1}`).join(",")},updated_at=CURRENT_TIMESTAMP WHERE price_book_id=$${values.length} RETURNING *`,
      values,
    );
    const updated = result.rows[0];
    const pricingSync =
      updated.is_default && updated.is_active
        ? await syncProjectBasePrices(
            client,
            Number(updated.company_id),
            Number(updated.project_id),
            String(updated.currency),
          )
        : undefined;
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Price book updated",
      price_book: updated,
      ...(pricingSync ? { pricing_sync: pricingSync.counts } : {}),
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (inventoryDatabaseError(error) === "23505")
      return NextResponse.json(
        { error: "A price book with this code already exists in the project" },
        { status: 409 },
      );
    console.error("Failed to update price book", error);
    return NextResponse.json(
      { error: "Unable to update price book" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
