import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireInvitationAdmin } from "@/lib/invitationAdmin";

type Context = { params: Promise<{ invitationid: string }> };

export async function POST(request: NextRequest, context: Context) {
  const access = await requireInvitationAdmin(request, (await context.params).invitationid);
  if (!access.ok) return access.response;
  try {
    const result = await pool.query(
      `UPDATE workspace_invitations
       SET status='expired', expires_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
       WHERE invitation_id=$1 AND company_id=$2 AND status='pending'
       RETURNING invitation_id`,
      [access.invitationId, access.companyId],
    );
    if (!result.rowCount) {
      return NextResponse.json({ error: "Pending invitation not found" }, { status: 404 });
    }
    return NextResponse.json({ message: "Invitation expired" });
  } catch (error) {
    console.error("Failed to expire invitation", error);
    return NextResponse.json({ error: "Unable to expire invitation" }, { status: 500 });
  }
}
