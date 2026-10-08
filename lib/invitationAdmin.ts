import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/authorization";
import { isUuid } from "@/lib/permissions";

export async function requireInvitationAdmin(
  request: NextRequest,
  invitationId: string,
) {
  if (!isUuid(invitationId)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "invitationId must be a valid UUID" },
        { status: 400 },
      ),
    };
  }
  const scope = await requirePermission(request, "PEOPLE_MANAGE");
  if (!scope.ok) return scope;
  return {
    ok: true as const,
    invitationId,
    companyId: scope.context.access.company.company_id,
    userId: scope.context.userId,
  };
}

export async function getInvitationForDelivery(
  invitationId: string,
  companyId: number,
) {
  const result = await pool.query(
    `SELECT wi.*, c.company_name, r.role_name, r.role_key, t.name AS team_name,
            CONCAT_WS(' ', inviter.first_name, inviter.last_name) AS inviter_name,
            COALESCE((
              SELECT jsonb_agg(p.project_name ORDER BY p.project_name, p.project_id)
              FROM workspace_invitation_projects wip
              JOIN projects p ON p.project_id=wip.project_id
              WHERE wip.invitation_id=wi.invitation_id
            ), '[]'::jsonb) AS project_names
     FROM workspace_invitations wi
     JOIN companies c ON c.company_id=wi.company_id
     JOIN roles r ON r.role_id=wi.role_id
     JOIN teams t ON t.team_id=wi.team_id
     JOIN users inviter ON inviter.user_id=wi.invited_by
     WHERE wi.invitation_id=$1 AND wi.company_id=$2`,
    [invitationId, companyId],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

export function pendingInvitationError(invitation?: Record<string, unknown>) {
  if (!invitation) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }
  if (invitation.status !== "pending") {
    return NextResponse.json(
      { error: `This invitation is already ${String(invitation.status)}` },
      { status: 409 },
    );
  }
  return null;
}
