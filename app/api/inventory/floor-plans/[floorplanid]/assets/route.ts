import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  isRecord,
  jsonObjectValue,
  numberValue,
  parseInventoryUuid,
  textValue,
} from "@/lib/inventory";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
type Context = { params: Promise<{ floorplanid: string }> };
export async function POST(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const id = parseInventoryUuid((await context.params).floorplanid);
  if (!id)
    return NextResponse.json(
      { error: "floorPlanId must be a valid UUID" },
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
  const kind = textValue(body.asset_kind, "asset_kind", errors, {
    required: true,
    maximum: 40,
  });
  const url = textValue(body.asset_url, "asset_url", errors, {
    required: true,
    maximum: 5000,
  });
  if (url) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol))
        errors.push("asset_url must use http or https");
    } catch {
      errors.push("asset_url must be a valid URL");
    }
  }
  const fileName = textValue(body.file_name, "file_name", errors, {
    nullable: true,
    maximum: 255,
  });
  const mime = textValue(body.mime_type, "mime_type", errors, {
    nullable: true,
    maximum: 150,
  });
  const size = numberValue(body.file_size_bytes, "file_size_bytes", errors, {
    nullable: true,
    minimum: 0,
    integer: true,
  });
  const order =
    numberValue(body.display_order, "display_order", errors, {
      minimum: 1,
      integer: true,
    }) ?? 1;
  const metadata = jsonObjectValue(body.metadata, "metadata", errors) ?? {};
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  try {
    const plan = await pool.query(
      "SELECT * FROM inventory_floor_plans WHERE floor_plan_id=$1",
      [id],
    );
    if (!plan.rowCount)
      return NextResponse.json(
        { error: "Floor plan not found" },
        { status: 404 },
      );
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(plan.rows[0].company_id),
        Number(plan.rows[0].project_id),
      )
    )
      return NextResponse.json(
        { error: "You do not have access to this floor plan" },
        { status: 403 },
      );
    const result = await pool.query(
      `INSERT INTO inventory_floor_plan_assets (floor_plan_id,asset_kind,asset_url,file_name,mime_type,file_size_bytes,display_order,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        id,
        kind,
        url,
        fileName ?? null,
        mime ?? null,
        size ?? null,
        order,
        metadata,
      ],
    );
    return NextResponse.json(
      { message: "Floor plan asset added", asset: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    )
      return NextResponse.json(
        { error: "This asset is already attached to the floor plan" },
        { status: 409 },
      );
    console.error("Failed to add floor plan asset", error);
    return NextResponse.json(
      { error: "Unable to add floor plan asset" },
      { status: 500 },
    );
  }
}
