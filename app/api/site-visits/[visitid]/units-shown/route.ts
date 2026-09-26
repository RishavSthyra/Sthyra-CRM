import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import {
  getSiteVisit,
  parseVisitUuid,
  validateUnitsShown,
} from "@/lib/siteVisits";

type Context = { params: Promise<{ visitid: string }> };
async function accessVisit(request: NextRequest, rawId: string) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope;
  const visitId = parseVisitUuid(rawId);
  if (!visitId)
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "visitId must be a valid UUID" },
        { status: 400 },
      ),
    };
  const visit = await getSiteVisit(pool, visitId);
  if (!visit)
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Site visit not found" },
        { status: 404 },
      ),
    };
  if (
    !canAccessOperationsEntity(
      scope.context.access,
      Number(visit.company_id),
      Number(visit.project_id),
    )
  )
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "You do not have access to this site visit" },
        { status: 403 },
      ),
    };
  return { ok: true as const, context: scope.context, visitId, visit };
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const access = await accessVisit(request, (await context.params).visitid);
    if (!access.ok) return access.response;
    const result = await pool.query(
      `SELECT svu.*, iu.unit_code, iu.unit_name,
      iu.area_sqft, iu.status AS unit_status, iu.node_id, iu.unit_type_id,
      node.node_kind, node.node_code, node.node_name,
      unit_type.type_code, unit_type.type_name, unit_type.configuration,
      asset_type.type_key AS asset_type_key, asset_type.display_name AS asset_type_name
      FROM site_visit_units_shown svu
      JOIN inventory_units iu ON iu.unit_id=svu.unit_id
      LEFT JOIN project_inventory_nodes node ON node.node_id=iu.node_id
      LEFT JOIN inventory_unit_types unit_type ON unit_type.unit_type_id=iu.unit_type_id
      LEFT JOIN inventory_asset_types asset_type ON asset_type.asset_type_id=unit_type.asset_type_id
      WHERE svu.visit_id=$1 ORDER BY svu.display_order`,
      [access.visitId],
    );
    return NextResponse.json({ units: result.rows });
  } catch (error) {
    console.error("Failed to retrieve units shown", error);
    return NextResponse.json(
      { error: "Unable to retrieve units shown" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, context: Context) {
  const access = await accessVisit(request, (await context.params).visitid);
  if (!access.ok) return access.response;
  if (["cancelled", "no_show"].includes(String(access.visit.status)))
    return NextResponse.json(
      { error: "Units cannot be recorded for a cancelled or no-show visit" },
      { status: 409 },
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
  const validation = validateUnitsShown(body);
  if (!validation.ok)
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (validation.data.length) {
      const units = await client.query(
        "SELECT unit_id FROM inventory_units WHERE project_id=$1 AND company_id=$2 AND archived_at IS NULL AND unit_id=ANY($3::uuid[])",
        [
          access.visit.project_id,
          access.visit.company_id,
          validation.data.map((unit) => unit.unit_id),
        ],
      );
      if (units.rowCount !== validation.data.length) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Every unit must belong to the site visit project" },
          { status: 422 },
        );
      }
    }
    await client.query("DELETE FROM site_visit_units_shown WHERE visit_id=$1", [
      access.visitId,
    ]);
    for (const unit of validation.data)
      await client.query(
        `INSERT INTO site_visit_units_shown (visit_id,unit_id,display_order,interest_level,notes,shown_at,shown_by)
       VALUES ($1,$2,$3,$4,$5,CASE WHEN $6 IN ('checked_in','completed') THEN CURRENT_TIMESTAMP ELSE NULL END,$7)`,
        [
          access.visitId,
          unit.unit_id,
          unit.display_order,
          unit.interest_level ?? null,
          unit.notes ?? null,
          access.visit.status,
          access.context.userId,
        ],
      );
    await client.query("COMMIT");
    const result = await pool.query(
      `SELECT svu.*, iu.unit_code, iu.unit_name,
      iu.area_sqft, iu.status AS unit_status, iu.node_id, iu.unit_type_id,
      node.node_kind, node.node_code, node.node_name,
      unit_type.type_code, unit_type.type_name, unit_type.configuration,
      asset_type.type_key AS asset_type_key, asset_type.display_name AS asset_type_name
      FROM site_visit_units_shown svu
      JOIN inventory_units iu ON iu.unit_id=svu.unit_id
      LEFT JOIN project_inventory_nodes node ON node.node_id=iu.node_id
      LEFT JOIN inventory_unit_types unit_type ON unit_type.unit_type_id=iu.unit_type_id
      LEFT JOIN inventory_asset_types asset_type ON asset_type.asset_type_id=unit_type.asset_type_id
      WHERE svu.visit_id=$1 ORDER BY svu.display_order`,
      [access.visitId],
    );
    return NextResponse.json({
      message: "Units shown replaced",
      units: result.rows,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to replace units shown", error);
    return NextResponse.json(
      { error: "Unable to replace units shown" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
