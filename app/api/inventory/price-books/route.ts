import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  assertOnlyFields,
  booleanValue,
  inventoryDatabaseError,
  isRecord,
  parseProjectForAccess,
  textValue,
} from "@/lib/inventory";
import { requireOperationsContext } from "@/lib/operationsAccess";

function dateValue(value: unknown, field: string, errors: string[]) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    errors.push(`${field} must be a valid YYYY-MM-DD date or null`);
    return undefined;
  }
  return value;
}
export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const projectId = parseProjectForAccess(
    request.nextUrl.searchParams.get("project_id"),
    scope.context.access,
  );
  if (!projectId)
    return NextResponse.json(
      { error: "A valid accessible project_id is required" },
      { status: 400 },
    );
  try {
    const result = await pool.query(
      `SELECT book.*,COUNT(entry.price_entry_id)::integer AS entry_count FROM inventory_price_books book LEFT JOIN inventory_price_book_entries entry ON entry.price_book_id=book.price_book_id WHERE book.project_id=$1 GROUP BY book.price_book_id ORDER BY book.is_default DESC,book.price_book_name`,
      [projectId],
    );
    return NextResponse.json({ price_books: result.rows });
  } catch (error) {
    console.error("Failed to list price books", error);
    return NextResponse.json(
      { error: "Unable to retrieve price books" },
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
      "project_id",
      "price_book_code",
      "price_book_name",
      "currency",
      "valid_from",
      "valid_until",
      "is_default",
    ],
    errors,
  );
  const projectId = parseProjectForAccess(
    body.project_id,
    scope.context.access,
  );
  if (!projectId) errors.push("project_id must be an accessible project");
  const code = textValue(body.price_book_code, "price_book_code", errors, {
    required: true,
    maximum: 100,
  });
  const name = textValue(body.price_book_name, "price_book_name", errors, {
    required: true,
    maximum: 200,
  });
  const currency = (
    textValue(body.currency, "currency", errors, { maximum: 3 }) ?? "INR"
  ).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    errors.push("currency must be a three-letter ISO code");
  const from = dateValue(body.valid_from, "valid_from", errors);
  const until = dateValue(body.valid_until, "valid_until", errors);
  if (from && until && until < from)
    errors.push("valid_until cannot be before valid_from");
  const isDefault =
    booleanValue(body.is_default, "is_default", errors) ?? false;
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (isDefault)
      await client.query(
        "UPDATE inventory_price_books SET is_default=FALSE,updated_at=CURRENT_TIMESTAMP WHERE project_id=$1 AND is_default=TRUE",
        [projectId],
      );
    const result = await client.query(
      `INSERT INTO inventory_price_books (company_id,project_id,price_book_code,price_book_name,currency,valid_from,valid_until,is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        scope.context.access.company.company_id,
        projectId,
        code,
        name,
        currency,
        from ?? null,
        until ?? null,
        isDefault,
      ],
    );
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Price book created", price_book: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (inventoryDatabaseError(error) === "23505")
      return NextResponse.json(
        { error: "A price book with this code already exists in the project" },
        { status: 409 },
      );
    console.error("Failed to create price book", error);
    return NextResponse.json(
      { error: "Unable to create price book" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
