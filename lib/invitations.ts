import nodemailer from "nodemailer";
import { createOpaqueToken, hashToken } from "@/lib/auth";
import { getSmtpConfig } from "@/lib/smtp";

export const INVITATION_LIFETIME_DAYS = 7;

export type InvitationEmailData = {
  email: string;
  companyName: string;
  roleName: string;
  teamName: string;
  inviterName: string;
  invitationUrl: string;
  expiresAt: Date;
};

export function createInvitationToken() {
  const token = createOpaqueToken();
  return { token, tokenHash: hashToken(token) };
}

export function invitationUrl(token: string, origin: string) {
  const configured = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  const base = (configured || origin).replace(/\/$/, "");
  return `${base}/invite/${encodeURIComponent(token)}`;
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character]!,
  );
}

export async function sendInvitationEmail(data: InvitationEmailData) {
  const smtp = getSmtpConfig();
  if (!smtp) {
    return {
      sent: false as const,
      error:
        "SMTP is not configured. Add the SMTP variables or EMAIL_USER and GOOGLE_APP_PASSWORD.",
    };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  const company = escapeHtml(data.companyName);
  const role = escapeHtml(data.roleName);
  const team = escapeHtml(data.teamName);
  const inviter = escapeHtml(data.inviterName || "A workspace administrator");
  const url = escapeHtml(data.invitationUrl);
  const expiry = escapeHtml(
    data.expiresAt.toLocaleString("en-IN", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    }),
  );
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Invitation to join ${company}</title>
  </head>
  <body style="margin:0;padding:0;background:#ffffff;color:#18201e;font-family:Arial,Helvetica,sans-serif;color-scheme:light;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;background:#ffffff;">
      <tr>
        <td align="center" style="padding:40px 20px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
            <tr>
              <td style="padding:0 0 20px;border-bottom:1px solid #e4e8e6;">
                <span style="font-size:18px;line-height:24px;font-weight:700;letter-spacing:-0.02em;color:#111714;">STHYRA</span>
                <span style="margin-left:7px;font-size:13px;line-height:24px;font-weight:600;color:#69736f;">CRM</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 0 0;">
                <h1 style="margin:0 0 14px;font-size:28px;line-height:36px;font-weight:700;letter-spacing:-0.02em;color:#111714;">You’re invited to join ${company}</h1>
                <p style="margin:0;font-size:16px;line-height:26px;color:#59635f;">${inviter} invited you to join their workspace on Sthyra CRM.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:1px solid #e1e6e3;border-radius:8px;border-collapse:separate;">
                  <tr>
                    <td style="width:120px;padding:15px 18px;border-bottom:1px solid #e8ecea;font-size:13px;line-height:20px;color:#69736f;">Workspace</td>
                    <td style="padding:15px 18px;border-bottom:1px solid #e8ecea;font-size:14px;line-height:20px;font-weight:600;color:#18201e;">${company}</td>
                  </tr>
                  <tr>
                    <td style="width:120px;padding:15px 18px;border-bottom:1px solid #e8ecea;font-size:13px;line-height:20px;color:#69736f;">Team</td>
                    <td style="padding:15px 18px;border-bottom:1px solid #e8ecea;font-size:14px;line-height:20px;font-weight:600;color:#18201e;">${team}</td>
                  </tr>
                  <tr>
                    <td style="width:120px;padding:15px 18px;font-size:13px;line-height:20px;color:#69736f;">Role</td>
                    <td style="padding:15px 18px;font-size:14px;line-height:20px;font-weight:600;color:#18201e;">${role}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 24px;">
                <a href="${url}" style="display:inline-block;padding:13px 20px;border-radius:7px;background:#247a62;color:#ffffff;font-size:15px;line-height:20px;font-weight:700;text-decoration:none;">Accept invitation</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 30px;">
                <p style="margin:0 0 16px;font-size:13px;line-height:21px;color:#69736f;">This invitation expires on <strong style="font-weight:600;color:#3c4743;">${expiry}</strong>.</p>
                <p style="margin:0 0 5px;font-size:12px;line-height:19px;color:#7a8580;">If the button does not work, copy and paste this link into your browser:</p>
                <a href="${url}" style="font-size:12px;line-height:19px;color:#176b55;text-decoration:underline;word-break:break-all;">${url}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 0 0;border-top:1px solid #e4e8e6;">
                <p style="margin:0 0 6px;font-size:12px;line-height:19px;color:#7a8580;">If you were not expecting this invitation, you can safely ignore this email.</p>
                <p style="margin:0;font-size:12px;line-height:19px;color:#929a97;">Sthyra CRM</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  try {
    await transporter.sendMail({
      from: smtp.from,
      to: data.email,
      subject: `Join ${data.companyName} on Sthyra CRM`,
      text: `${data.inviterName || "A workspace administrator"} invited you to join ${data.companyName} as ${data.roleName} in ${data.teamName}. Accept before ${expiry}: ${data.invitationUrl}`,
      html,
    });
    return { sent: true as const };
  } catch (error) {
    console.error("Failed to send invitation email", error);
    return {
      sent: false as const,
      error: "The invitation email could not be delivered.",
    };
  }
}
