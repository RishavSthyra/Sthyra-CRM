import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  inventoryDatabaseError,
  isRecord,
  numberValue,
  parseProjectForAccess,
  textValue,
  uuidValue,
} from "@/lib/inventory";
import { requireOperationsContext } from "@/lib/operationsAccess";

type Stack = {
  stack_code: string;
  unit_type_id: string;
  unit_name: string | null;
};
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
  const mode =
    body.mode === "stacked" || body.mode === "series" ? body.mode : null;
  if (!mode) errors.push("mode must be stacked or series");
  const parentNodeId = uuidValue(
    body.parent_node_id,
    "parent_node_id",
    errors,
    true,
  );
  const prefix = textValue(body.unit_code_prefix, "unit_code_prefix", errors, {
    required: true,
    maximum: 80,
  });
  const padding =
    numberValue(body.number_padding, "number_padding", errors, {
      minimum: 1,
      integer: true,
    }) ?? 3;
  const startNumber =
    numberValue(body.start_number, "start_number", errors, {
      minimum: 0,
      integer: true,
    }) ?? 1;
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  let quantity = 0;
  let levelCount = 0;
  let levelStart = 1;
  let buildingCode: string | null = null;
  let buildingName: string | null = null;
  let buildingKind = "tower";
  let levelKind = "floor";
  let levelCodePrefix = "F";
  let unitTypeId: string | null = null;
  const stacks: Stack[] = [];
  if (mode === "series") {
    quantity =
      numberValue(body.quantity, "quantity", errors, {
        minimum: 1,
        integer: true,
      }) ?? 0;
    unitTypeId = uuidValue(body.unit_type_id, "unit_type_id", errors) ?? null;
  }
  if (mode === "stacked") {
    levelCount =
      numberValue(body.level_count, "level_count", errors, {
        minimum: 1,
        integer: true,
      }) ?? 0;
    levelStart =
      numberValue(body.level_start, "level_start", errors, {
        minimum: 0,
        integer: true,
      }) ?? 1;
    buildingCode =
      textValue(body.building_code, "building_code", errors, {
        required: true,
        maximum: 100,
      }) ?? null;
    buildingName =
      textValue(body.building_name, "building_name", errors, {
        required: true,
        maximum: 200,
      }) ?? null;
    buildingKind =
      textValue(body.building_kind, "building_kind", errors, { maximum: 80 }) ??
      "tower";
    levelKind =
      textValue(body.level_kind, "level_kind", errors, { maximum: 80 }) ??
      "floor";
    levelCodePrefix =
      textValue(body.level_code_prefix, "level_code_prefix", errors, {
        maximum: 40,
      }) ?? "F";
    if (!Array.isArray(body.stacks) || body.stacks.length === 0)
      errors.push("stacks must contain at least one stack");
    else
      body.stacks.forEach((raw, index) => {
        if (!isRecord(raw)) {
          errors.push(`stacks[${index}] must be an object`);
          return;
        }
        const code = textValue(
          raw.stack_code,
          `stacks[${index}].stack_code`,
          errors,
          { required: true, maximum: 40 },
        );
        const typeId = uuidValue(
          raw.unit_type_id,
          `stacks[${index}].unit_type_id`,
          errors,
        );
        const name = textValue(
          raw.unit_name,
          `stacks[${index}].unit_name`,
          errors,
          { nullable: true, maximum: 200 },
        );
        if (code && typeId)
          stacks.push({
            stack_code: code,
            unit_type_id: typeId,
            unit_name: name ?? null,
          });
      });
    if (
      new Set(stacks.map((stack) => stack.stack_code.toLowerCase())).size !==
      stacks.length
    )
      errors.push("stack_code values must be unique");
  }
  const total = mode === "series" ? quantity : levelCount * stacks.length;
  if (total > 5000)
    errors.push("A generation request cannot create more than 5000 units");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (parentNodeId) {
      const parent = await client.query(
        "SELECT 1 FROM project_inventory_nodes WHERE node_id=$1 AND company_id=$2 AND project_id=$3",
        [parentNodeId, scope.context.access.company.company_id, projectId],
      );
      if (!parent.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "parent_node_id must belong to the selected project" },
          { status: 422 },
        );
      }
    }
    const typeIds =
      mode === "series"
        ? [unitTypeId!]
        : stacks.map((stack) => stack.unit_type_id);
    const types = await client.query(
      "SELECT unit_type_id FROM inventory_unit_types WHERE company_id=$1 AND project_id=$2 AND is_active=TRUE AND unit_type_id=ANY($3::uuid[])",
      [scope.context.access.company.company_id, projectId, typeIds],
    );
    if (types.rowCount !== new Set(typeIds).size) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            "Every unit_type_id must be active and belong to the selected project",
        },
        { status: 422 },
      );
    }
    const job = await client.query(
      `INSERT INTO inventory_import_jobs (company_id,project_id,source,status,total_rows,mapping,created_by,started_at) VALUES ($1,$2,'generator','processing',$3,$4,$5,CURRENT_TIMESTAMP) RETURNING *`,
      [
        scope.context.access.company.company_id,
        projectId,
        total,
        { mode, prefix, padding, start_number: startNumber },
        scope.context.userId,
      ],
    );
    const importId = job.rows[0].import_id;
    let created = 0;
    if (mode === "series") {
      for (let index = 0; index < quantity; index++) {
        const sequence = startNumber + index;
        const code = `${prefix}${String(sequence).padStart(padding, "0")}`;
        const unit = await client.query(
          `INSERT INTO inventory_units (company_id,project_id,node_id,unit_type_id,unit_code,unit_name,external_unit_key,metadata) VALUES ($1,$2,$3,$4,$5,$6,$5,$7) RETURNING *`,
          [
            scope.context.access.company.company_id,
            projectId,
            parentNodeId ?? null,
            unitTypeId,
            code,
            code,
            metadata,
          ],
        );
        await client.query(
          `INSERT INTO inventory_unit_status_history (unit_id,from_status,to_status,reason,metadata,performed_by) VALUES ($1,NULL,'available','Generated inventory',$2,$3)`,
          [
            unit.rows[0].unit_id,
            { import_id: importId, sequence },
            scope.context.userId,
          ],
        );
        await client.query(
          `INSERT INTO inventory_import_rows (import_id,row_number,raw_data,normalized_data,status,unit_id) VALUES ($1,$2,$3,$3,'imported',$4)`,
          [
            importId,
            index + 1,
            {
              unit_code: code,
              unit_type_id: unitTypeId,
              node_id: parentNodeId,
            },
            unit.rows[0].unit_id,
          ],
        );
        created++;
      }
    } else {
      const building = await client.query(
        `INSERT INTO project_inventory_nodes (company_id,project_id,parent_node_id,node_kind,node_code,node_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          scope.context.access.company.company_id,
          projectId,
          parentNodeId ?? null,
          buildingKind,
          buildingCode,
          buildingName,
        ],
      );
      for (let levelOffset = 0; levelOffset < levelCount; levelOffset++) {
        const levelNumber = levelStart + levelOffset;
        const levelCode = `${buildingCode}-${levelCodePrefix}${String(levelNumber).padStart(2, "0")}`;
        const level = await client.query(
          `INSERT INTO project_inventory_nodes (company_id,project_id,parent_node_id,node_kind,node_code,node_name,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            scope.context.access.company.company_id,
            projectId,
            building.rows[0].node_id,
            levelKind,
            levelCode,
            `${levelKind.replace(/_/g, " ")} ${levelNumber}`,
            levelNumber,
          ],
        );
        for (let stackIndex = 0; stackIndex < stacks.length; stackIndex++) {
          const stack = stacks[stackIndex];
          const code = `${prefix}${String(levelNumber).padStart(padding, "0")}${stack.stack_code}`;
          const unit = await client.query(
            `INSERT INTO inventory_units (company_id,project_id,node_id,unit_type_id,unit_code,unit_name,external_unit_key,metadata) VALUES ($1,$2,$3,$4,$5,$6,$5,$7) RETURNING *`,
            [
              scope.context.access.company.company_id,
              projectId,
              level.rows[0].node_id,
              stack.unit_type_id,
              code,
              stack.unit_name ?? code,
              metadata,
            ],
          );
          await client.query(
            `INSERT INTO inventory_unit_status_history (unit_id,from_status,to_status,reason,metadata,performed_by) VALUES ($1,NULL,'available','Generated inventory',$2,$3)`,
            [
              unit.rows[0].unit_id,
              {
                import_id: importId,
                level: levelNumber,
                stack: stack.stack_code,
              },
              scope.context.userId,
            ],
          );
          created++;
          await client.query(
            `INSERT INTO inventory_import_rows (import_id,row_number,raw_data,normalized_data,status,unit_id) VALUES ($1,$2,$3,$3,'imported',$4)`,
            [
              importId,
              created,
              {
                unit_code: code,
                unit_type_id: stack.unit_type_id,
                node_id: level.rows[0].node_id,
              },
              unit.rows[0].unit_id,
            ],
          );
        }
      }
    }
    const finished = await client.query(
      `UPDATE inventory_import_jobs SET status='completed',processed_rows=$2,succeeded_rows=$2,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE import_id=$1 RETURNING *`,
      [importId, created],
    );
    await client.query("COMMIT");
    return NextResponse.json(
      {
        message: `Generated ${created} inventory units`,
        import: finished.rows[0],
        created_units: created,
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (inventoryDatabaseError(error) === "23505")
      return NextResponse.json(
        { error: "Generation conflicts with an existing node or unit code" },
        { status: 409 },
      );
    console.error("Failed to generate inventory", error);
    return NextResponse.json(
      { error: "Unable to generate inventory" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
