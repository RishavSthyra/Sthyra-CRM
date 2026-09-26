import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getInvitationForDelivery,
  pendingInvitationError,
  requireInvitationAdmin,
} from "@/lib/invitationAdmin";
import { createInvitationToken, invitationUrl } from "@/lib/invitations";

type Context = { params: Promise<{ invitationid: string }> };

export async function POST(request: NextRequest, context: Context) {
  const access = await requireInvitationAdmin(
    request,
    (await context.params).invitationid,
  );
  if (!access.ok) return access.response;
  try {
    const invitation = await getInvitationForDelivery(
      access.invitationId,
      access.companyId,
    );
    const invalid = pendingInvitationError(invitation);
    if (invalid) return invalid;
    const { token, tokenHash } = createInvitationToken();
    const rotated = await pool.query(
      `UPDATE workspace_invitations
       SET token_hash=$2, expires_at=CURRENT_TIMESTAMP + INTERVAL '7 days',
           updated_at=CURRENT_TIMESTAMP
       WHERE invitation_id=$1 AND company_id=$3 AND status='pending'`,
      [access.invitationId, tokenHash, access.companyId],
    );
    if (!rotated.rowCount) {
      return NextResponse.json(
        { error: "This invitation is no longer pending" },
        { status: 409 },
      );
    }
    return NextResponse.json({
      message: "A fresh invitation link was generated and copied",
      invitation_url: invitationUrl(token, request.nextUrl.origin),
    });
  } catch (error) {
    console.error("Failed to generate invitation link", error);
    return NextResponse.json(
      { error: "Unable to generate invitation link" },
      { status: 500 },
    );
  }
}
