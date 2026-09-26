import nodemailer from "nodemailer";
import type { EmailAttachmentInput } from "@/lib/communications";

function plainText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

export async function deliverCrmEmail(data: {
  fromAddress: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  attachments: EmailAttachmentInput[];
}) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const configuredFrom = process.env.SMTP_FROM;
  if (
    !host ||
    !user ||
    !pass ||
    !configuredFrom ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return { configured: false as const, sent: false as const };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user, pass },
  });
  try {
    const result = await transporter.sendMail({
      from: configuredFrom,
      replyTo: data.fromAddress,
      to: data.to,
      cc: data.cc.length ? data.cc : undefined,
      subject: data.subject,
      text: plainText(data.body),
      html: data.body,
      attachments: data.attachments.map((attachment) => ({
        filename: attachment.file_name,
        content: attachment.content,
        contentType: attachment.mime_type,
      })),
    });
    return {
      configured: true as const,
      sent: true as const,
      messageId: result.messageId,
    };
  } catch (error) {
    console.error("Failed to deliver CRM email", error);
    return {
      configured: true as const,
      sent: false as const,
      error: "The email provider rejected the message.",
    };
  }
}
