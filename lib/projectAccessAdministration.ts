import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/authorization";

export async function requireProjectAccessManager(request: NextRequest) {
  const scope = await requirePermission(request, "PEOPLE_MANAGE");
  if (!scope.ok) return scope;

  const leadership = await pool.query(
    `SELECT 1
     FROM users u
     JOIN teams t ON t.team_id = u.team_id
     WHERE u.user_id = $1
       AND u.deleted_at IS NULL
       AND u.is_active = TRUE
       AND t.company_id = $2
       AND t.is_active = TRUE
       AND LOWER(BTRIM(t.name)) = 'leadership'`,
    [scope.context.userId, scope.context.access.company.company_id],
  );

  if (!leadership.rowCount) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Only active Leadership team members can manage project access" },
        { status: 403 },
      ),
    };
  }

  return scope;
}
