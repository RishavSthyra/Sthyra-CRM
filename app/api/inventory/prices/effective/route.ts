import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getInventoryUnit, parseInventoryUuid } from "@/lib/inventory";
import { totalPrice } from "@/lib/inventoryPricing";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";

function dateParameter(value: string | null) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  )
    return null;
  return value;
}

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;

  const unitId = parseInventoryUuid(
    request.nextUrl.searchParams.get("unit_id") ?? "",
  );
  if (!unitId)
    return NextResponse.json(
      { error: "unit_id must be a valid UUID" },
      { status: 400 },
    );
  const requestedBook = request.nextUrl.searchParams.get("price_book_id");
  const priceBookId = requestedBook ? parseInventoryUuid(requestedBook) : null;
  if (requestedBook && !priceBookId)
    return NextResponse.json(
      { error: "price_book_id must be a valid UUID" },
      { status: 400 },
    );
  const asOf = dateParameter(request.nextUrl.searchParams.get("as_of"));
  if (!asOf)
    return NextResponse.json(
      { error: "as_of must be a valid YYYY-MM-DD date" },
      { status: 400 },
    );

  try {
    const unit = await getInventoryUnit(pool, unitId);
    if (!unit)
      return NextResponse.json(
        { error: "Inventory unit not found" },
        { status: 404 },
      );
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(unit.company_id),
        Number(unit.project_id),
      )
    )
      return NextResponse.json(
        { error: "You do not have access to this inventory unit" },
        { status: 403 },
      );

    if (unit.price_override !== null) {
      return NextResponse.json({
        price: {
          source: "unit_override",
          target: "unit",
          base_amount: unit.price_override,
          components: {},
          total_amount: Number(unit.price_override),
          currency: unit.currency,
          as_of: asOf,
        },
      });
    }

    const book = await pool.query(
      `SELECT * FROM inventory_price_books
       WHERE project_id=$1 AND is_active=TRUE
         AND ($2::uuid IS NULL OR price_book_id=$2)
         AND ($2::uuid IS NOT NULL OR is_default=TRUE)
         AND (valid_from IS NULL OR valid_from<=$3::date)
         AND (valid_until IS NULL OR valid_until>=$3::date)
       ORDER BY is_default DESC,created_at
       LIMIT 1`,
      [unit.project_id, priceBookId, asOf],
    );
    if (book.rowCount) {
      const entry = await pool.query(
        `SELECT * FROM inventory_price_book_entries
         WHERE price_book_id=$1
           AND (unit_id=$2 OR (unit_id IS NULL AND unit_type_id=$3))
           AND (valid_from IS NULL OR valid_from<=$4::date)
           AND (valid_until IS NULL OR valid_until>=$4::date)
         ORDER BY CASE WHEN unit_id=$2 THEN 0 ELSE 1 END,
                  valid_from DESC NULLS LAST,updated_at DESC
         LIMIT 1`,
        [book.rows[0].price_book_id, unitId, unit.unit_type_id, asOf],
      );
      if (entry.rowCount) {
        const selected = entry.rows[0];
        const components = selected.components as Record<string, unknown>;
        return NextResponse.json({
          price: {
            ...selected,
            source:
              selected.unit_id !== null ? "unit_price_book" : selected.source,
            target: selected.unit_id !== null ? "unit" : "unit_type",
            total_amount: totalPrice(selected.base_amount, components),
            currency: book.rows[0].currency,
            price_book_id: book.rows[0].price_book_id,
            price_book_code: book.rows[0].price_book_code,
            price_book_name: book.rows[0].price_book_name,
            as_of: asOf,
          },
        });
      }
    }

    if (unit.base_price !== null) {
      return NextResponse.json({
        price: {
          source: "unit_type_fallback",
          target: "unit_type",
          base_amount: unit.base_price,
          components: {},
          total_amount: Number(unit.base_price),
          currency: unit.type_currency,
          as_of: asOf,
        },
      });
    }

    return NextResponse.json(
      { error: "No effective price is configured for this unit" },
      { status: 404 },
    );
  } catch (error) {
    console.error("Failed to resolve effective inventory price", error);
    return NextResponse.json(
      { error: "Unable to resolve effective inventory price" },
      { status: 500 },
    );
  }
}
