import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireTransfer } from "@/lib/transferAccess";

type Context = { params: Promise<{ transferid: string }> };
export async function GET(request: NextRequest, context: Context) {
  const access = await requireTransfer(request, (await context.params).transferid);
  if (!access.ok) return access.response;
  try {
    const [users, teams] = await Promise.all([
      pool.query(
        `SELECT u.user_id, u.first_name, u.last_name, u.email,
                u.team_id, t.name AS team_name
         FROM users u
         JOIN teams t ON t.team_id=u.team_id
         JOIN roles r ON r.role_id=u.role_id
         WHERE t.company_id=$1 AND u.is_active=TRUE AND u.deleted_at IS NULL
           AND t.is_active=TRUE AND r.is_active=TRUE
           AND (
             r.role_key IN ('COMPANY_OWNER','COMPANY_ADMIN','SUPER_ADMIN')
             OR EXISTS (SELECT 1 FROM user_projects up WHERE up.user_id=u.user_id AND up.project_id=$2)
             OR EXISTS (SELECT 1 FROM team_projects tp WHERE tp.team_id=u.team_id AND tp.project_id=$2)
           )
           AND u.user_id IS DISTINCT FROM $3
         ORDER BY u.first_name, u.last_name, u.user_id`,
        [access.transfer.company_id, access.transfer.project_id, access.transfer.from_owner_user_id],
      ),
      pool.query(
        `SELECT t.team_id, t.name AS team_name, t.team_type
         FROM teams t
         WHERE t.company_id=$1 AND t.is_active=TRUE
           AND EXISTS (SELECT 1 FROM team_projects tp WHERE tp.team_id=t.team_id AND tp.project_id=$2)
           AND t.team_id IS DISTINCT FROM $3
         ORDER BY t.name, t.team_id`,
        [access.transfer.company_id, access.transfer.project_id, access.transfer.from_team_id],
      ),
    ]);
    return NextResponse.json({ users: users.rows, teams: teams.rows });
  } catch (error) {
    console.error("Failed to retrieve eligible transfer recipients", error);
    return NextResponse.json({ error: "Unable to retrieve eligible recipients" }, { status: 500 });
  }
}

