import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  booleanValue,
  inventoryDatabaseError,
  isRecord,
  normalizeKey,
  numberValue,
  parseProjectForAccess,
  textValue,
} from "@/lib/inventory";
import { requireOperationsContext } from "@/lib/operationsAccess";
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
      "SELECT * FROM inventory_attribute_definitions WHERE project_id=$1 ORDER BY applies_to,display_order,label",
      [projectId],
    );
    return NextResponse.json({ attributes: result.rows });
  } catch (error) {
    console.error("Failed to list inventory attributes", error);
    return NextResponse.json(
      { error: "Unable to retrieve inventory attributes" },
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
  const projectId = parseProjectForAccess(
    body.project_id,
    scope.context.access,
  );
  if (!projectId) errors.push("project_id must be an accessible project");
  const appliesTo = ["unit_type", "unit"].includes(String(body.applies_to))
    ? String(body.applies_to)
    : null;
  if (!appliesTo) errors.push("applies_to must be unit_type or unit");
  const label = textValue(body.label, "label", errors, {
    required: true,
    maximum: 150,
  });
  const key = normalizeKey(
    textValue(body.attribute_key, "attribute_key", errors, {
      nullable: true,
      maximum: 100,
    }) ||
      label ||
      "",
  );
  if (!key) errors.push("attribute_key or label must produce a valid key");
  const dataType = [
    "text",
    "number",
    "boolean",
    "date",
    "select",
    "multi_select",
  ].includes(String(body.data_type))
    ? String(body.data_type)
    : null;
  if (!dataType) errors.push("data_type is invalid");
  const required =
    booleanValue(body.is_required, "is_required", errors) ?? false;
  const options =
    body.options === undefined
      ? []
      : Array.isArray(body.options)
        ? body.options
        : null;
  if (!options) errors.push("options must be an array");
  if (
    ["select", "multi_select"].includes(dataType ?? "") &&
    options?.length === 0
  )
    errors.push("Select attributes require at least one option");
  const order =
    numberValue(body.display_order, "display_order", errors, {
      minimum: 0,
      integer: true,
    }) ?? 0;
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  try {
    const result = await pool.query(
      `INSERT INTO inventory_attribute_definitions (company_id,project_id,applies_to,attribute_key,label,data_type,is_required,options,display_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        scope.context.access.company.company_id,
        projectId,
        appliesTo,
        key,
        label,
        dataType,
        required,
        options,
        order,
      ],
    );
    return NextResponse.json(
      { message: "Inventory attribute created", attribute: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    if (inventoryDatabaseError(error) === "23505")
      return NextResponse.json(
        {
          error:
            "An attribute with this key already exists for the selected scope",
        },
        { status: 409 },
      );
    console.error("Failed to create inventory attribute", error);
    return NextResponse.json(
      { error: "Unable to create inventory attribute" },
      { status: 500 },
    );
  }
}
