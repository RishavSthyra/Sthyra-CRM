import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { isRecord, parseProjectForAccess, textValue } from "@/lib/inventory";
import { syncProjectBasePrices } from "@/lib/inventoryPricing";
import { requireOperationsContext } from "@/lib/operationsAccess";

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
  const projectId = parseProjectForAccess(
    body.project_id,
    scope.context.access,
  );
  if (!projectId) errors.push("project_id must be an accessible project");
  const currency = (
    textValue(body.currency, "currency", errors, { maximum: 3 }) ?? "INR"
  ).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    errors.push("currency must be a three-letter ISO code");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await syncProjectBasePrices(
      client,
      scope.context.access.company.company_id,
      projectId!,
      currency,
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Default price book synchronized",
      price_book: result.price_book,
      counts: result.counts,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to synchronize default price book", error);
    return NextResponse.json(
      { error: "Unable to synchronize default price book" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
