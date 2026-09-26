import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  assertOnlyFields,
  inventoryDatabaseError,
  isRecord,
  jsonObjectValue,
  numberValue,
  parseProjectForAccess,
  textValue,
} from "@/lib/inventory";
import { requireOperationsContext } from "@/lib/operationsAccess";

const FLOOR_PLAN_SELECT = `SELECT fp.*,
  COALESCE(jsonb_agg(jsonb_build_object('asset_id',a.asset_id,'asset_kind',a.asset_kind,'asset_url',a.asset_url,'file_name',a.file_name,'mime_type',a.mime_type,'file_size_bytes',a.file_size_bytes,'display_order',a.display_order,'metadata',a.metadata) ORDER BY a.display_order,a.asset_id) FILTER (WHERE a.asset_id IS NOT NULL),'[]'::jsonb) AS assets
  FROM inventory_floor_plans fp LEFT JOIN inventory_floor_plan_assets a ON a.floor_plan_id=fp.floor_plan_id`;

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
  const includeInactive =
    request.nextUrl.searchParams.get("include_inactive") === "true";
  try {
    const result = await pool.query(
      `${FLOOR_PLAN_SELECT} WHERE fp.project_id=$1 AND ($2::boolean=TRUE OR fp.is_active=TRUE) GROUP BY fp.floor_plan_id ORDER BY fp.plan_name,fp.version DESC`,
      [projectId, includeInactive],
    );
    return NextResponse.json({ floor_plans: result.rows });
  } catch (error) {
    console.error("Failed to list floor plans", error);
    return NextResponse.json(
      { error: "Unable to retrieve floor plans" },
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
      "plan_code",
      "plan_name",
      "version",
      "description",
      "dimensions",
      "content_hash",
      "assets",
    ],
    errors,
  );
  const projectId = parseProjectForAccess(
    body.project_id,
    scope.context.access,
  );
  if (!projectId) errors.push("project_id must be an accessible project");
  const planCode = textValue(body.plan_code, "plan_code", errors, {
    required: true,
    maximum: 100,
  });
  const planName = textValue(body.plan_name, "plan_name", errors, {
    required: true,
    maximum: 200,
  });
  const version =
    numberValue(body.version, "version", errors, {
      minimum: 1,
      integer: true,
    }) ?? 1;
  const description = textValue(body.description, "description", errors, {
    nullable: true,
    maximum: 10000,
  });
  const dimensions =
    jsonObjectValue(body.dimensions, "dimensions", errors) ?? {};
  const contentHash = textValue(body.content_hash, "content_hash", errors, {
    nullable: true,
    maximum: 128,
  });
  const assets: {
    asset_kind: string;
    asset_url: string;
    file_name: string | null;
    mime_type: string | null;
    file_size_bytes: number | null;
    display_order: number;
    metadata: Record<string, unknown>;
  }[] = [];
  if (body.assets !== undefined) {
    if (!Array.isArray(body.assets)) errors.push("assets must be an array");
    else
      body.assets.forEach((raw, index) => {
        if (!isRecord(raw)) {
          errors.push(`assets[${index}] must be an object`);
          return;
        }
        const kind = textValue(
          raw.asset_kind,
          `assets[${index}].asset_kind`,
          errors,
          { required: true, maximum: 40 },
        );
        const url = textValue(
          raw.asset_url,
          `assets[${index}].asset_url`,
          errors,
          { required: true, maximum: 5000 },
        );
        if (url) {
          try {
            const parsed = new URL(url);
            if (!["http:", "https:"].includes(parsed.protocol))
              errors.push(`assets[${index}].asset_url must use http or https`);
          } catch {
            errors.push(`assets[${index}].asset_url must be a valid URL`);
          }
        }
        const fileName = textValue(
          raw.file_name,
          `assets[${index}].file_name`,
          errors,
          { nullable: true, maximum: 255 },
        );
        const mimeType = textValue(
          raw.mime_type,
          `assets[${index}].mime_type`,
          errors,
          { nullable: true, maximum: 150 },
        );
        const size = numberValue(
          raw.file_size_bytes,
          `assets[${index}].file_size_bytes`,
          errors,
          { nullable: true, minimum: 0, integer: true },
        );
        const order =
          numberValue(
            raw.display_order,
            `assets[${index}].display_order`,
            errors,
            { minimum: 1, integer: true },
          ) ?? index + 1;
        const metadata =
          jsonObjectValue(raw.metadata, `assets[${index}].metadata`, errors) ??
          {};
        if (kind && url)
          assets.push({
            asset_kind: kind,
            asset_url: url,
            file_name: fileName ?? null,
            mime_type: mimeType ?? null,
            file_size_bytes: size ?? null,
            display_order: order,
            metadata,
          });
      });
  }
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO inventory_floor_plans (company_id,project_id,plan_code,plan_name,version,description,dimensions,content_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        scope.context.access.company.company_id,
        projectId,
        planCode,
        planName,
        version,
        description ?? null,
        dimensions,
        contentHash ?? null,
      ],
    );
    for (const asset of assets)
      await client.query(
        `INSERT INTO inventory_floor_plan_assets (floor_plan_id,asset_kind,asset_url,file_name,mime_type,file_size_bytes,display_order,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          result.rows[0].floor_plan_id,
          asset.asset_kind,
          asset.asset_url,
          asset.file_name,
          asset.mime_type,
          asset.file_size_bytes,
          asset.display_order,
          asset.metadata,
        ],
      );
    await client.query("COMMIT");
    return NextResponse.json(
      {
        message: "Floor plan created",
        floor_plan: { ...result.rows[0], assets },
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (inventoryDatabaseError(error) === "23505")
      return NextResponse.json(
        {
          error:
            "This floor plan code and version already exist in the project",
        },
        { status: 409 },
      );
    console.error("Failed to create floor plan", error);
    return NextResponse.json(
      { error: "Unable to create floor plan" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
