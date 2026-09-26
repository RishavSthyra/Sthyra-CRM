import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseProjectForAccess } from "@/lib/inventory";
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
    const [statuses, assetTypes, totals, holds] = await Promise.all([
      pool.query(
        `SELECT status,COUNT(*)::integer AS count FROM inventory_units WHERE project_id=$1 AND archived_at IS NULL GROUP BY status ORDER BY status`,
        [projectId],
      ),
      pool.query(
        `SELECT at.asset_type_id,at.type_key,at.display_name,COUNT(iu.unit_id)::integer AS unit_count FROM inventory_unit_types ut JOIN inventory_asset_types at ON at.asset_type_id=ut.asset_type_id LEFT JOIN inventory_units iu ON iu.unit_type_id=ut.unit_type_id AND iu.archived_at IS NULL WHERE ut.project_id=$1 GROUP BY at.asset_type_id ORDER BY at.display_name`,
        [projectId],
      ),
      pool.query(
        `SELECT (SELECT COUNT(*) FROM project_inventory_nodes WHERE project_id=$1 AND is_active=TRUE)::integer AS node_count,(SELECT COUNT(*) FROM inventory_unit_types WHERE project_id=$1 AND is_active=TRUE)::integer AS unit_type_count,(SELECT COUNT(*) FROM inventory_floor_plans WHERE project_id=$1 AND is_active=TRUE)::integer AS floor_plan_count,(SELECT COUNT(*) FROM inventory_units WHERE project_id=$1 AND archived_at IS NULL)::integer AS unit_count`,
        [projectId],
      ),
      pool.query(
        `SELECT COUNT(*)::integer AS active_holds,COUNT(*) FILTER (WHERE expires_at<=CURRENT_TIMESTAMP+INTERVAL '24 hours')::integer AS expiring_within_24_hours FROM inventory_holds WHERE project_id=$1 AND status='active'`,
        [projectId],
      ),
    ]);
    return NextResponse.json({
      project_id: projectId,
      ...totals.rows[0],
      status_counts: statuses.rows,
      asset_type_counts: assetTypes.rows,
      holds: holds.rows[0],
    });
  } catch (error) {
    console.error("Failed to retrieve inventory summary", error);
    return NextResponse.json(
      { error: "Unable to retrieve inventory summary" },
      { status: 500 },
    );
  }
}
