import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  assertOnlyFields,
  inventoryDatabaseError,
  isRecord,
  jsonObjectValue,
  parseProjectForAccess,
  textValue,
  uuidValue,
  numberValue,
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
      `WITH RECURSIVE tree AS (
         SELECT n.*, 0 AS depth, ARRAY[n.node_id] AS path_ids,
                ARRAY[LPAD(n.sort_order::text,10,'0') || ':' || n.node_name] AS sort_path
         FROM project_inventory_nodes n
         WHERE n.project_id=$1 AND n.parent_node_id IS NULL
         UNION ALL
         SELECT child.*, parent.depth+1, parent.path_ids || child.node_id,
                parent.sort_path || (LPAD(child.sort_order::text,10,'0') || ':' || child.node_name)
         FROM project_inventory_nodes child JOIN tree parent ON parent.node_id=child.parent_node_id
         WHERE NOT child.node_id=ANY(parent.path_ids)
       ) SELECT * FROM tree ORDER BY sort_path`,
      [projectId],
    );
    return NextResponse.json({ nodes: result.rows });
  } catch (error) {
    console.error("Failed to list inventory nodes", error);
    return NextResponse.json(
      { error: "Unable to retrieve inventory structure" },
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
      "parent_node_id",
      "node_kind",
      "node_code",
      "node_name",
      "sort_order",
      "attributes",
    ],
    errors,
  );
  const projectId = parseProjectForAccess(
    body.project_id,
    scope.context.access,
  );
  if (!projectId) errors.push("project_id must be an accessible project");
  const parentId = uuidValue(
    body.parent_node_id,
    "parent_node_id",
    errors,
    true,
  );
  const nodeKind = textValue(body.node_kind, "node_kind", errors, {
    required: true,
    maximum: 80,
  });
  const nodeCode = textValue(body.node_code, "node_code", errors, {
    required: true,
    maximum: 100,
  });
  const nodeName = textValue(body.node_name, "node_name", errors, {
    required: true,
    maximum: 200,
  });
  const sortOrder =
    numberValue(body.sort_order, "sort_order", errors, {
      minimum: 0,
      integer: true,
    }) ?? 0;
  const attributes =
    jsonObjectValue(body.attributes, "attributes", errors) ?? {};
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  try {
    if (parentId) {
      const parent = await pool.query(
        "SELECT 1 FROM project_inventory_nodes WHERE node_id=$1 AND company_id=$2 AND project_id=$3",
        [parentId, scope.context.access.company.company_id, projectId],
      );
      if (!parent.rowCount)
        return NextResponse.json(
          { error: "parent_node_id must belong to the selected project" },
          { status: 422 },
        );
    }
    const result = await pool.query(
      `INSERT INTO project_inventory_nodes (company_id,project_id,parent_node_id,node_kind,node_code,node_name,sort_order,attributes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        scope.context.access.company.company_id,
        projectId,
        parentId ?? null,
        nodeKind,
        nodeCode,
        nodeName,
        sortOrder,
        attributes,
      ],
    );
    return NextResponse.json(
      { message: "Inventory structure node created", node: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    if (inventoryDatabaseError(error) === "23505")
      return NextResponse.json(
        { error: "A node with this code already exists in the project" },
        { status: 409 },
      );
    console.error("Failed to create inventory node", error);
    return NextResponse.json(
      { error: "Unable to create inventory structure node" },
      { status: 500 },
    );
  }
}
