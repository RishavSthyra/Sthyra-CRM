import type { NextRequest } from "next/server";
import { adminPool } from "@/lib/db";
import { workspaceSlugFromHostname } from "@/lib/tenantHost";

export async function crmUserMatchesRequestWorkspace(
  request: NextRequest,
  userId: string,
): Promise<boolean> {
  const workspaceSlug = workspaceSlugFromHostname(request.nextUrl.hostname);
  if (!workspaceSlug) return true;

  const result = await adminPool.query(
    `SELECT 1
     FROM users crm_user
     JOIN teams team ON team.team_id = crm_user.team_id
     JOIN companies company ON company.company_id = team.company_id
     WHERE crm_user.user_id = $1
       AND crm_user.is_active = TRUE
       AND crm_user.deleted_at IS NULL
       AND company.archived_at IS NULL
       AND company.workspace_slug = $2
     LIMIT 1`,
    [userId, workspaceSlug],
  );
  return Boolean(result.rowCount);
}
