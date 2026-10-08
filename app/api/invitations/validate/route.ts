import { NextRequest, NextResponse } from "next/server";
import pool, { adminPool } from "@/lib/db";
import { hashToken } from "@/lib/auth";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { enforceRateLimits } from "@/lib/rateLimit";

export async function GET(request: NextRequest) {
  const database = isSupabaseAuthConfigured() ? adminPool : pool;
  const token = request.nextUrl.searchParams.get("token")?.trim();
  if (!token || token.length > 200) {
    return NextResponse.json({ error: "Invalid invitation link" }, { status: 400 });
  }
  const rateLimit = await enforceRateLimits(request, [
    { action: "invitation-validate:ip", limit: 30, windowSeconds: 10 * 60 },
    {
      action: "invitation-validate:token",
      subject: `token:${token}`,
      limit: 10,
      windowSeconds: 10 * 60,
    },
  ]);
  if (rateLimit) return rateLimit;
  try {
    const result = await database.query(
      `SELECT wi.invitation_id, wi.email, wi.status, wi.expires_at,
              c.company_name, c.company_code, r.role_name, r.role_key,
              t.name AS team_name,
              COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'project_id', p.project_id,
                    'project_name', p.project_name,
                    'project_code', p.project_code
                  ) ORDER BY p.project_name, p.project_id
                )
                FROM workspace_invitation_projects wip
                JOIN projects p ON p.project_id=wip.project_id
                WHERE wip.invitation_id=wi.invitation_id
              ), '[]'::jsonb) AS projects
       FROM workspace_invitations wi
       JOIN companies c ON c.company_id=wi.company_id
       JOIN roles r ON r.role_id=wi.role_id
       JOIN teams t ON t.team_id=wi.team_id
       WHERE wi.token_hash=$1`,
      [hashToken(token)],
    );
    if (!result.rowCount) {
      return NextResponse.json({ error: "This invitation link is invalid" }, { status: 404 });
    }
    const invitation = result.rows[0];
    if (invitation.status === "pending" && new Date(invitation.expires_at) <= new Date()) {
      await database.query(
        `UPDATE workspace_invitations SET status='expired', updated_at=CURRENT_TIMESTAMP
         WHERE invitation_id=$1 AND status='pending'`,
        [invitation.invitation_id],
      );
      invitation.status = "expired";
    }
    if (invitation.status !== "pending") {
      return NextResponse.json(
        { error: `This invitation has been ${invitation.status}` },
        { status: 410 },
      );
    }
    const response = NextResponse.json({ invitation });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Failed to validate invitation", error);
    return NextResponse.json({ error: "Unable to validate invitation" }, { status: 500 });
  }
}
