import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  booleanValue,
  inventoryDatabaseError,
  isInventoryStatus,
  isRecord,
  jsonObjectValue,
  numberValue,
  parseProjectForAccess,
  textValue,
  uuidValue,
} from "@/lib/inventory";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams, 30, 100);
  if (!pagination.ok)
    return NextResponse.json({ error: pagination.error }, { status: 400 });
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
    const count = await pool.query(
      "SELECT COUNT(*)::integer AS total FROM inventory_import_jobs WHERE project_id=$1",
      [projectId],
    );
    const result = await pool.query(
      "SELECT * FROM inventory_import_jobs WHERE project_id=$1 ORDER BY created_at DESC,import_id DESC LIMIT $2 OFFSET $3",
      [projectId, pagination.limit, pagination.offset],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      imports: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list inventory imports", error);
    return NextResponse.json(
      { error: "Unable to retrieve inventory imports" },
      { status: 500 },
    );
  }
}

type NormalizedRow = {
  unit_code: string;
  unit_name: string | null;
  external_unit_key: string | null;
  node_id: string | null;
  unit_type_id: string;
  orientation: string | null;
  area_sqft: number | null;
  price_override: number | null;
  currency: string;
  status: string;
  metadata: Record<string, unknown>;
};
function normalizeRow(
  raw: unknown,
  index: number,
  lookups: { typeByCode: Map<string, string>; nodeByCode: Map<string, string> },
): { data?: NormalizedRow; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) return { errors: [`Row ${index} must be an object`] };
  const unitCode = textValue(raw.unit_code, "unit_code", errors, {
    required: true,
    maximum: 100,
  });
  const unitName = textValue(raw.unit_name, "unit_name", errors, {
    nullable: true,
    maximum: 200,
  });
  const externalKey = textValue(
    raw.external_unit_key,
    "external_unit_key",
    errors,
    { nullable: true, maximum: 200 },
  );
  const orientation = textValue(raw.orientation, "orientation", errors, {
    nullable: true,
    maximum: 100,
  });
  const area = numberValue(raw.area_sqft, "area_sqft", errors, {
    nullable: true,
    minimum: 0.01,
  });
  const price = numberValue(raw.price_override, "price_override", errors, {
    nullable: true,
    minimum: 0,
  });
  const currency = (
    textValue(raw.currency, "currency", errors, { maximum: 3 }) ?? "INR"
  ).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    errors.push("currency must be a three-letter ISO code");
  const metadata = jsonObjectValue(raw.metadata, "metadata", errors) ?? {};
  let typeId =
    uuidValue(raw.unit_type_id, "unit_type_id", errors, true) ?? null;
  if (!typeId && typeof raw.unit_type_code === "string")
    typeId =
      lookups.typeByCode.get(raw.unit_type_code.trim().toLowerCase()) ?? null;
  if (!typeId)
    errors.push("unit_type_id or a known unit_type_code is required");
  let nodeId = uuidValue(raw.node_id, "node_id", errors, true) ?? null;
  if (!nodeId && typeof raw.node_code === "string" && raw.node_code.trim())
    nodeId = lookups.nodeByCode.get(raw.node_code.trim().toLowerCase()) ?? null;
  if (typeof raw.node_code === "string" && raw.node_code.trim() && !nodeId)
    errors.push("node_code was not found in the project");
  const status = raw.status === undefined ? "available" : String(raw.status);
  if (!isInventoryStatus(status)) errors.push("status is invalid");
  return errors.length
    ? { errors }
    : {
        errors: [],
        data: {
          unit_code: unitCode!,
          unit_name: unitName ?? null,
          external_unit_key: externalKey ?? null,
          node_id: nodeId,
          unit_type_id: typeId!,
          orientation: orientation ?? null,
          area_sqft: area ?? null,
          price_override: price ?? null,
          currency,
          status,
          metadata,
        },
      };
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
  const projectId = parseProjectForAccess(
    body.project_id,
    scope.context.access,
  );
  if (!projectId)
    return NextResponse.json(
      { error: "project_id must be an accessible project" },
      { status: 422 },
    );
  if (
    !Array.isArray(body.rows) ||
    body.rows.length === 0 ||
    body.rows.length > 5000
  )
    return NextResponse.json(
      { error: "rows must contain between 1 and 5000 inventory rows" },
      { status: 422 },
    );
  const source = ["csv", "xlsx", "api"].includes(String(body.source))
    ? String(body.source)
    : "api";
  const fileName =
    typeof body.file_name === "string"
      ? body.file_name.trim().slice(0, 255) || null
      : null;
  const idempotencyKey =
    typeof body.idempotency_key === "string"
      ? body.idempotency_key.trim().slice(0, 200) || null
      : null;
  const upsert = booleanValue(body.upsert, "upsert", []) ?? false;
  const mapping = isRecord(body.mapping) ? body.mapping : {};
  if (idempotencyKey) {
    const existing = await pool.query(
      "SELECT * FROM inventory_import_jobs WHERE company_id=$1 AND idempotency_key=$2",
      [scope.context.access.company.company_id, idempotencyKey],
    );
    if (existing.rowCount)
      return NextResponse.json(
        { message: "Import already accepted", import: existing.rows[0] },
        { status: 200 },
      );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const job = await client.query(
      `INSERT INTO inventory_import_jobs (company_id,project_id,source,file_name,status,idempotency_key,total_rows,mapping,created_by,started_at) VALUES ($1,$2,$3,$4,'processing',$5,$6,$7,$8,CURRENT_TIMESTAMP) RETURNING *`,
      [
        scope.context.access.company.company_id,
        projectId,
        source,
        fileName,
        idempotencyKey,
        body.rows.length,
        mapping,
        scope.context.userId,
      ],
    );
    const importId = job.rows[0].import_id;
    const [types, nodes] = await Promise.all([
      client.query(
        "SELECT unit_type_id,type_code FROM inventory_unit_types WHERE company_id=$1 AND project_id=$2 AND is_active=TRUE",
        [scope.context.access.company.company_id, projectId],
      ),
      client.query(
        "SELECT node_id,node_code FROM project_inventory_nodes WHERE company_id=$1 AND project_id=$2 AND is_active=TRUE",
        [scope.context.access.company.company_id, projectId],
      ),
    ]);
    const lookups = {
      typeByCode: new Map<string, string>(
        types.rows.map((row) => [
          String(row.type_code).toLowerCase(),
          String(row.unit_type_id),
        ]),
      ),
      nodeByCode: new Map<string, string>(
        nodes.rows.map((row) => [
          String(row.node_code).toLowerCase(),
          String(row.node_id),
        ]),
      ),
    };
    const validTypeIds = new Set(
      types.rows.map((row) => String(row.unit_type_id)),
    );
    const validNodeIds = new Set(nodes.rows.map((row) => String(row.node_id)));
    let succeeded = 0;
    let failed = 0;
    for (let index = 0; index < body.rows.length; index++) {
      const raw = body.rows[index];
      const normalized = normalizeRow(raw, index + 1, lookups);
      if (normalized.data && !validTypeIds.has(normalized.data.unit_type_id))
        normalized.errors.push("unit_type_id does not belong to this project");
      if (
        normalized.data?.node_id &&
        !validNodeIds.has(normalized.data.node_id)
      )
        normalized.errors.push("node_id does not belong to this project");
      await client.query(
        `INSERT INTO inventory_import_rows (import_id,row_number,raw_data,normalized_data,status,errors) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          importId,
          index + 1,
          isRecord(raw) ? raw : { value: raw },
          normalized.data ?? null,
          normalized.errors.length ? "failed" : "valid",
          normalized.errors,
        ],
      );
      if (normalized.errors.length || !normalized.data) {
        failed++;
        continue;
      }
      const row = normalized.data;
      await client.query("SAVEPOINT inventory_row");
      try {
        const existing = await client.query(
          `SELECT * FROM inventory_units WHERE project_id=$1 AND archived_at IS NULL AND (unit_code=$2 OR ($3::text IS NOT NULL AND external_unit_key=$3)) FOR UPDATE`,
          [projectId, row.unit_code, row.external_unit_key],
        );
        let unit;
        if (existing.rowCount) {
          if (!upsert)
            throw new Error(
              "A unit with this code or external key already exists",
            );
          const previous = existing.rows[0];
          const result = await client.query(
            `UPDATE inventory_units SET node_id=$2,unit_type_id=$3,unit_code=$4,unit_name=$5,external_unit_key=$6,orientation=$7,area_sqft=$8,price_override=$9,currency=$10,status=$11,metadata=$12,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE unit_id=$1 RETURNING *`,
            [
              previous.unit_id,
              row.node_id,
              row.unit_type_id,
              row.unit_code,
              row.unit_name,
              row.external_unit_key,
              row.orientation,
              row.area_sqft,
              row.price_override,
              row.currency,
              row.status,
              row.metadata,
            ],
          );
          unit = result.rows[0];
          if (previous.status !== row.status)
            await client.query(
              `INSERT INTO inventory_unit_status_history (unit_id,from_status,to_status,reason,metadata,performed_by) VALUES ($1,$2,$3,'Bulk import update',$4,$5)`,
              [
                unit.unit_id,
                previous.status,
                row.status,
                { import_id: importId, row_number: index + 1 },
                scope.context.userId,
              ],
            );
        } else {
          const result = await client.query(
            `INSERT INTO inventory_units (company_id,project_id,node_id,unit_type_id,unit_code,unit_name,external_unit_key,orientation,area_sqft,price_override,currency,status,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [
              scope.context.access.company.company_id,
              projectId,
              row.node_id,
              row.unit_type_id,
              row.unit_code,
              row.unit_name,
              row.external_unit_key,
              row.orientation,
              row.area_sqft,
              row.price_override,
              row.currency,
              row.status,
              row.metadata,
            ],
          );
          unit = result.rows[0];
          await client.query(
            `INSERT INTO inventory_unit_status_history (unit_id,from_status,to_status,reason,metadata,performed_by) VALUES ($1,NULL,$2,'Bulk import',$3,$4)`,
            [
              unit.unit_id,
              row.status,
              { import_id: importId, row_number: index + 1 },
              scope.context.userId,
            ],
          );
        }
        await client.query("RELEASE SAVEPOINT inventory_row");
        await client.query(
          "UPDATE inventory_import_rows SET status='imported',unit_id=$3,updated_at=CURRENT_TIMESTAMP WHERE import_id=$1 AND row_number=$2",
          [importId, index + 1, unit.unit_id],
        );
        succeeded++;
      } catch (rowError) {
        await client.query("ROLLBACK TO SAVEPOINT inventory_row");
        await client.query("RELEASE SAVEPOINT inventory_row");
        failed++;
        const message =
          rowError instanceof Error ? rowError.message : "Unable to import row";
        await client.query(
          "UPDATE inventory_import_rows SET status='failed',errors=$3,updated_at=CURRENT_TIMESTAMP WHERE import_id=$1 AND row_number=$2",
          [importId, index + 1, [message]],
        );
      }
    }
    const status =
      failed === 0 ? "completed" : succeeded === 0 ? "failed" : "partial";
    const finished = await client.query(
      `UPDATE inventory_import_jobs SET status=$2,processed_rows=total_rows,succeeded_rows=$3,failed_rows=$4,error_summary=CASE WHEN $4>0 THEN $4::text || ' row(s) failed validation or import' ELSE NULL END,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE import_id=$1 RETURNING *`,
      [importId, status, succeeded, failed],
    );
    await client.query("COMMIT");
    return NextResponse.json(
      {
        message:
          status === "completed"
            ? "Inventory import completed"
            : "Inventory import completed with errors",
        import: finished.rows[0],
      },
      { status: status === "completed" ? 201 : 207 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (inventoryDatabaseError(error) === "23505" && idempotencyKey) {
      const existing = await pool.query(
        "SELECT * FROM inventory_import_jobs WHERE company_id=$1 AND idempotency_key=$2",
        [scope.context.access.company.company_id, idempotencyKey],
      );
      if (existing.rowCount)
        return NextResponse.json({
          message: "Import already accepted",
          import: existing.rows[0],
        });
    }
    console.error("Failed to import inventory", error);
    return NextResponse.json(
      { error: "Unable to import inventory" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
