import nodemailer from "nodemailer";
import { getSmtpConfig } from "@/lib/smtp";

export class AuthEmailConfigurationError extends Error {
  constructor() {
    super(
      "Authentication email is not configured. Add EMAIL_USER and GOOGLE_APP_PASSWORD.",
    );
    this.name = "AuthEmailConfigurationError";
  }
}

export async function sendSignupVerificationCode(input: {
  email: string;
  code: string;
}) {
  const smtp = getSmtpConfig();
  if (!smtp) throw new AuthEmailConfigurationError();

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  });

  await transporter.sendMail({
    from: smtp.from,
    to: input.email,
    subject: `${input.code} is your Sthyra CRM verification code`,
    text: `Your Sthyra CRM verification code is ${input.code}. Enter this ${input.code.length}-digit code on the verification screen. If you did not create this account, you can ignore this email.`,
    html: `<!doctype html><html><body style="margin:0;background:#080a09;color:#f2f5f4;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:48px 24px"><div style="border:1px solid #29322f;border-radius:20px;background:#111513;padding:34px"><div style="color:#63c5a3;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Sthyra CRM</div><h1 style="margin:18px 0 10px;font-size:28px">Verify your email</h1><p style="margin:0 0 24px;color:#9ba4a1;line-height:1.6">Enter this ${input.code.length}-digit code on the verification screen:</p><div style="display:inline-block;border-radius:12px;background:#27272a;color:#f5f5f5;padding:16px 22px;font-family:monospace;font-size:32px;font-weight:700;letter-spacing:.22em">${input.code}</div><p style="margin:24px 0 0;color:#707976;font-size:12px;line-height:1.5">If you did not create this account, you can safely ignore this email.</p></div></div></body></html>`,
  });
}
