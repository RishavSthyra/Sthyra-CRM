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
} from "@/lib/inventory";
import { requireOperationsContext } from "@/lib/operationsAccess";

type Context = { params: Promise<{ nodeid: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const id = parseInventoryUuid((await context.params).nodeid);
  if (!id)
    return NextResponse.json(
      { error: "nodeId must be a valid UUID" },
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
      "parent_node_id",
      "node_kind",
      "node_code",
      "node_name",
      "sort_order",
      "attributes",
      "is_active",
    ],
    errors,
  );
  const data = {
    parent_node_id: uuidValue(
      body.parent_node_id,
      "parent_node_id",
      errors,
      true,
    ),
    node_kind: textValue(body.node_kind, "node_kind", errors, { maximum: 80 }),
    node_code: textValue(body.node_code, "node_code", errors, { maximum: 100 }),
    node_name: textValue(body.node_name, "node_name", errors, { maximum: 200 }),
    sort_order: numberValue(body.sort_order, "sort_order", errors, {
      minimum: 0,
      integer: true,
    }),
    attributes: jsonObjectValue(body.attributes, "attributes", errors),
    is_active: booleanValue(body.is_active, "is_active", errors),
  };
  if (!Object.keys(body).length) errors.push("At least one field is required");
  if (data.parent_node_id === id)
    errors.push("A node cannot be its own parent");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT * FROM project_inventory_nodes WHERE node_id=$1 AND company_id=$2 FOR UPDATE",
      [id, scope.context.access.company.company_id],
    );
    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Inventory structure node not found" },
        { status: 404 },
      );
    }
    if (data.parent_node_id) {
      const parent = await client.query(
        `WITH RECURSIVE descendants AS (SELECT node_id FROM project_inventory_nodes WHERE parent_node_id=$1 UNION ALL SELECT n.node_id FROM project_inventory_nodes n JOIN descendants d ON n.parent_node_id=d.node_id) SELECT 1 FROM project_inventory_nodes p WHERE p.node_id=$2 AND p.project_id=$3 AND p.company_id=$4 AND p.node_id<>$1 AND NOT EXISTS (SELECT 1 FROM descendants WHERE node_id=p.node_id)`,
        [
          id,
          data.parent_node_id,
          existing.rows[0].project_id,
          scope.context.access.company.company_id,
        ],
      );
      if (!parent.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            error:
              "parent_node_id is invalid or would create a hierarchy cycle",
          },
          { status: 422 },
        );
      }
    }
    const fields = Object.entries(data).filter(
      ([, value]) => value !== undefined,
    );
    const values = fields.map(([, value]) => value);
    values.push(id);
    const result = await client.query(
      `UPDATE project_inventory_nodes SET ${fields.map(([key], index) => `${key}=$${index + 1}`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE node_id=$${values.length} RETURNING *`,
      values,
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Inventory structure node updated",
      node: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (inventoryDatabaseError(error) === "23505")
      return NextResponse.json(
        { error: "A node with this code already exists in the project" },
        { status: 409 },
      );
    console.error("Failed to update inventory node", error);
    return NextResponse.json(
      { error: "Unable to update inventory structure node" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
