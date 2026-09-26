import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOperationsContext } from "@/lib/operationsAccess";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;

  try {
    const result = await pool.query(
      `SELECT DISTINCT u.user_id, u.first_name, u.last_name, u.email
       FROM users u
       JOIN teams t ON t.team_id=u.team_id
       WHERE t.company_id=$1
         AND t.is_active=TRUE
         AND u.is_active=TRUE
         AND u.deleted_at IS NULL
       ORDER BY u.first_name, u.last_name, u.email`,
      [scope.context.access.company.company_id],
    );
    const response = NextResponse.json({ users: result.rows });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Failed to retrieve appointment options", error);
    return NextResponse.json(
      { error: "Unable to retrieve appointment options" },
      { status: 500 },
    );
  }
}
