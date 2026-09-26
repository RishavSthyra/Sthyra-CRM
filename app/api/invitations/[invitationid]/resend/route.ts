import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getInvitationForDelivery,
  pendingInvitationError,
  requireInvitationAdmin,
} from "@/lib/invitationAdmin";
import {
  createInvitationToken,
  invitationUrl,
  sendInvitationEmail,
} from "@/lib/invitations";

type Context = { params: Promise<{ invitationid: string }> };
export const runtime = "nodejs";

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
       WHERE invitation_id=$1 AND company_id=$3 AND status='pending'
       RETURNING expires_at`,
      [access.invitationId, tokenHash, access.companyId],
    );
    if (!rotated.rowCount) {
      return NextResponse.json(
        { error: "This invitation is no longer pending" },
        { status: 409 },
      );
    }
    const link = invitationUrl(token, request.nextUrl.origin);
    const delivery = await sendInvitationEmail({
      email: String(invitation!.email),
      companyName: String(invitation!.company_name),
      roleName: String(invitation!.role_name),
      teamName: String(invitation!.team_name),
      inviterName: String(invitation!.inviter_name ?? ""),
      invitationUrl: link,
      expiresAt: new Date(rotated.rows[0].expires_at),
    });
    if (delivery.sent) {
      await pool
        .query(
          `UPDATE workspace_invitations
           SET sent_at=COALESCE(sent_at,CURRENT_TIMESTAMP), last_sent_at=CURRENT_TIMESTAMP,
               send_count=send_count+1, updated_at=CURRENT_TIMESTAMP
           WHERE invitation_id=$1`,
          [access.invitationId],
        )
        .catch((error) =>
          console.error("Failed to record invitation resend", error),
        );
    }
    return NextResponse.json({
      message: delivery.sent
        ? "Invitation resent"
        : "A new link was generated, but email delivery failed",
      invitation_url: link,
      email_sent: delivery.sent,
      delivery_error: delivery.sent ? undefined : delivery.error,
    });
  } catch (error) {
    console.error("Failed to resend invitation", error);
    return NextResponse.json(
      { error: "Unable to resend invitation" },
      { status: 500 },
    );
  }
}
