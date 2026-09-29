import nodemailer from "nodemailer";
import type { EmailAttachmentInput } from "@/lib/communications";
import { getSmtpConfig } from "@/lib/smtp";

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
  const smtp = getSmtpConfig();
  if (!smtp) {
    return { configured: false as const, sent: false as const };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  try {
    const result = await transporter.sendMail({
      from: smtp.from,
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
