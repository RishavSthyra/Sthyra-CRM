import nodemailer from "nodemailer";
import { createOpaqueToken, hashToken } from "@/lib/auth";

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
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;
  if (
    !host ||
    !user ||
    !pass ||
    !from ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return {
      sent: false as const,
      error: "SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM.",
    };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user, pass },
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

  try {
    await transporter.sendMail({
      from,
      to: data.email,
      subject: `Join ${data.companyName} on Sthyra CRM`,
      text: `${data.inviterName || "A workspace administrator"} invited you to join ${data.companyName} as ${data.roleName} in ${data.teamName}. Accept before ${expiry}: ${data.invitationUrl}`,
      html: `<!doctype html><html><body style="margin:0;background:#080a09;color:#f2f5f4;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:48px 24px"><div style="border:1px solid #29322f;border-radius:20px;background:#111513;padding:34px"><div style="color:#63c5a3;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Sthyra CRM</div><h1 style="margin:18px 0 10px;font-size:28px">Join ${company}</h1><p style="margin:0 0 24px;color:#9ba4a1;line-height:1.6">${inviter} invited you to the <strong style="color:#e9edeb">${team}</strong> team with the <strong style="color:#e9edeb">${role}</strong> role.</p><a href="${url}" style="display:inline-block;border-radius:10px;background:#2c8a6e;color:white;text-decoration:none;padding:14px 22px;font-weight:700">Accept invitation</a><p style="margin:24px 0 0;color:#707976;font-size:12px;line-height:1.5">This secure link expires on ${expiry}. If you did not expect this invitation, you can ignore this email.</p></div></div></body></html>`,
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
