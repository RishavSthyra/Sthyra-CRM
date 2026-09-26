import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { hashToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();
  if (!token || token.length > 200) {
    return NextResponse.json({ error: "Invalid invitation link" }, { status: 400 });
  }
  try {
    const result = await pool.query(
      `SELECT wi.invitation_id, wi.email, wi.status, wi.expires_at,
              c.company_name, c.company_code, r.role_name, t.name AS team_name
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
      await pool.query(
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
