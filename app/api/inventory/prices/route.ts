import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  assertOnlyFields,
  isRecord,
  jsonObjectValue,
  numberValue,
  parseInventoryUuid,
  uuidValue,
} from "@/lib/inventory";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const bookId = parseInventoryUuid(
    request.nextUrl.searchParams.get("price_book_id") ?? "",
  );
  if (!bookId)
    return NextResponse.json(
      { error: "price_book_id must be a valid UUID" },
      { status: 400 },
    );
  try {
    const book = await pool.query(
      "SELECT * FROM inventory_price_books WHERE price_book_id=$1",
      [bookId],
    );
    if (!book.rowCount)
      return NextResponse.json(
        { error: "Price book not found" },
        { status: 404 },
      );
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(book.rows[0].company_id),
        Number(book.rows[0].project_id),
      )
    )
      return NextResponse.json(
        { error: "You do not have access to this price book" },
        { status: 403 },
      );
    const result = await pool.query(
      `SELECT entry.*,ut.type_code,ut.type_name,iu.unit_code,iu.unit_name FROM inventory_price_book_entries entry LEFT JOIN inventory_unit_types ut ON ut.unit_type_id=entry.unit_type_id LEFT JOIN inventory_units iu ON iu.unit_id=entry.unit_id WHERE entry.price_book_id=$1 ORDER BY COALESCE(iu.unit_code,ut.type_code),entry.valid_from DESC NULLS LAST`,
      [bookId],
    );
    return NextResponse.json({ prices: result.rows });
  } catch (error) {
    console.error("Failed to retrieve inventory prices", error);
    return NextResponse.json(
      { error: "Unable to retrieve inventory prices" },
      { status: 500 },
    );
  }
}
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
  if (!isRecord(body))
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 422 },
    );
  const errors: string[] = [];
  assertOnlyFields(
    body,
    [
      "price_book_id",
      "unit_type_id",
      "unit_id",
      "base_amount",
      "components",
      "valid_from",
      "valid_until",
    ],
    errors,
  );
  const bookId = uuidValue(body.price_book_id, "price_book_id", errors);
  const unitTypeId = uuidValue(body.unit_type_id, "unit_type_id", errors, true);
  const unitId = uuidValue(body.unit_id, "unit_id", errors, true);
  if (Boolean(unitTypeId) === Boolean(unitId))
    errors.push("Exactly one of unit_type_id or unit_id is required");
  const amount = numberValue(body.base_amount, "base_amount", errors, {
    minimum: 0,
  });
  const components =
    jsonObjectValue(body.components, "components", errors) ?? {};
  const date = (value: unknown, field: string) => {
    if (value === undefined || value === null) return value as null | undefined;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      errors.push(`${field} must use YYYY-MM-DD format or be null`);
      return undefined;
    }
    return value;
  };
  const from = date(body.valid_from, "valid_from");
  const until = date(body.valid_until, "valid_until");
  if (from && until && until < from)
    errors.push("valid_until cannot be before valid_from");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const book = await client.query(
      "SELECT * FROM inventory_price_books WHERE price_book_id=$1 FOR UPDATE",
      [bookId],
    );
    if (!book.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Price book not found" },
        { status: 404 },
      );
    }
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(book.rows[0].company_id),
        Number(book.rows[0].project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this price book" },
        { status: 403 },
      );
    }
    const target = unitId
      ? await client.query(
          "SELECT 1 FROM inventory_units WHERE unit_id=$1 AND company_id=$2 AND project_id=$3",
          [unitId, book.rows[0].company_id, book.rows[0].project_id],
        )
      : await client.query(
          "SELECT 1 FROM inventory_unit_types WHERE unit_type_id=$1 AND company_id=$2 AND project_id=$3",
          [unitTypeId, book.rows[0].company_id, book.rows[0].project_id],
        );
    if (!target.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Price target must belong to the price book project" },
        { status: 422 },
      );
    }
    const result = await client.query(
      `INSERT INTO inventory_price_book_entries (price_book_id,unit_type_id,unit_id,base_amount,components,valid_from,valid_until) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        bookId,
        unitTypeId ?? null,
        unitId ?? null,
        amount,
        components,
        from ?? null,
        until ?? null,
      ],
    );
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Inventory price created", price: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    )
      return NextResponse.json(
        { error: "A price already exists for this target and effective date" },
        { status: 409 },
      );
    console.error("Failed to create inventory price", error);
    return NextResponse.json(
      { error: "Unable to create inventory price" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
