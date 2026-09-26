import nodemailer from "nodemailer";
import pool from "@/lib/db";
import type { EmailAttachmentInput } from "@/lib/communications";
import { decryptEmailToken, encryptEmailToken } from "@/lib/email/tokenEncryption";
import type { EmailProvider } from "@/lib/email/oauthProviders";

export type ConnectedMailbox = {
  email_connection_id: string;
  provider: EmailProvider;
  email_address: string;
  display_name: string | null;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: string | Date | null;
};

export type ProviderDelivery = {
  messageId: string | null;
  threadId: string | null;
  internetMessageId: string | null;
};

function plainText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function providerCredentials(provider: EmailProvider) {
  const google = provider === "google";
  const clientId = process.env[google ? "GOOGLE_CLIENT_ID" : "MICROSOFT_CLIENT_ID"]?.trim();
  const clientSecret = process.env[google ? "GOOGLE_CLIENT_SECRET" : "MICROSOFT_CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) throw new Error(`${provider} OAuth credentials are not configured`);
  return { clientId, clientSecret };
}

async function refreshAccessToken(connection: ConnectedMailbox): Promise<string> {
  if (!connection.refresh_token_ciphertext) {
    throw new Error("This mailbox needs to be reconnected");
  }
  const refreshToken = decryptEmailToken(connection.refresh_token_ciphertext);
  const { clientId, clientSecret } = providerCredentials(connection.provider);
  const google = connection.provider === "google";
  const tenant = process.env.MICROSOFT_TENANT_ID?.trim() || "common";
  const response = await fetch(
    google
      ? "https://oauth2.googleapis.com/token"
      : `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        ...(google
          ? {}
          : { scope: "openid profile email offline_access https://graph.microsoft.com/Mail.Send" }),
      }),
      cache: "no-store",
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    const reason = String(payload.error || "token_refresh_failed");
    if (reason === "invalid_grant" || response.status === 401) {
      await pool.query(
        `UPDATE email_connections
         SET status='reauthorization_required', last_error=$2, updated_at=CURRENT_TIMESTAMP
         WHERE email_connection_id=$1`,
        [connection.email_connection_id, String(payload.error_description || reason).slice(0, 2000)],
      );
    }
    throw new Error("Mailbox authorization expired. Reconnect the account in Settings.");
  }
  const expiresAt = new Date(Date.now() + Number(payload.expires_in || 3600) * 1000);
  await pool.query(
    `UPDATE email_connections
     SET access_token_ciphertext=$2,
         refresh_token_ciphertext=COALESCE($3, refresh_token_ciphertext),
         access_token_expires_at=$4, status='connected', last_error=NULL,
         updated_at=CURRENT_TIMESTAMP
     WHERE email_connection_id=$1`,
    [
      connection.email_connection_id,
      encryptEmailToken(payload.access_token),
      typeof payload.refresh_token === "string"
        ? encryptEmailToken(payload.refresh_token)
        : null,
      expiresAt,
    ],
  );
  return payload.access_token;
}

async function accessToken(connection: ConnectedMailbox): Promise<string> {
  const expiry = connection.access_token_expires_at
    ? new Date(connection.access_token_expires_at).getTime()
    : 0;
  if (connection.access_token_ciphertext && expiry > Date.now() + 60_000) {
    return decryptEmailToken(connection.access_token_ciphertext);
  }
  return refreshAccessToken(connection);
}

async function gmailRawMessage(args: {
  from: string;
  displayName: string | null;
  to: string[];
  cc: string[];
  subject: string;
  html: string;
  attachments: EmailAttachmentInput[];
}): Promise<string> {
  const transporter = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix",
  });
  const result = await transporter.sendMail({
    from: args.displayName
      ? { name: args.displayName, address: args.from }
      : args.from,
    to: args.to,
    cc: args.cc.length ? args.cc : undefined,
    subject: args.subject,
    text: plainText(args.html),
    html: args.html,
    attachments: args.attachments.map((attachment) => ({
      filename: attachment.file_name,
      content: attachment.content,
      contentType: attachment.mime_type,
    })),
  });
  const message = Buffer.isBuffer(result.message)
    ? result.message
    : Buffer.from(String(result.message));
  return message.toString("base64url");
}

async function sendGmail(
  connection: ConnectedMailbox,
  token: string,
  message: DeliveryMessage,
): Promise<ProviderDelivery> {
  const raw = await gmailRawMessage({
    from: connection.email_address,
    displayName: connection.display_name,
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    html: message.body,
    attachments: message.attachments,
  });
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
      cache: "no-store",
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    if (response.status === 401) throw new Error("MAILBOX_TOKEN_REJECTED");
    throw new Error(String((payload.error as { message?: string } | undefined)?.message || "Gmail rejected the message"));
  }
  return {
    messageId: typeof payload.id === "string" ? payload.id : null,
    threadId: typeof payload.threadId === "string" ? payload.threadId : null,
    internetMessageId: null,
  };
}

async function sendMicrosoft(
  connection: ConnectedMailbox,
  token: string,
  message: DeliveryMessage,
): Promise<ProviderDelivery> {
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: message.subject,
        body: { contentType: "HTML", content: message.body },
        toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
        ccRecipients: message.cc.map((address) => ({ emailAddress: { address } })),
        attachments: message.attachments.map((attachment) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: attachment.file_name,
          contentType: attachment.mime_type,
          contentBytes: attachment.content.toString("base64"),
        })),
      },
      saveToSentItems: true,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("MAILBOX_TOKEN_REJECTED");
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(payload?.error?.message || "Microsoft Graph rejected the message");
  }
  return { messageId: null, threadId: null, internetMessageId: null };
}

type DeliveryMessage = {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  attachments: EmailAttachmentInput[];
};

export async function deliverWithConnectedMailbox(
  connection: ConnectedMailbox,
  message: DeliveryMessage,
): Promise<ProviderDelivery> {
  let token = await accessToken(connection);
  try {
    return connection.provider === "google"
      ? await sendGmail(connection, token, message)
      : await sendMicrosoft(connection, token, message);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "MAILBOX_TOKEN_REJECTED") throw error;
    token = await refreshAccessToken(connection);
    return connection.provider === "google"
      ? sendGmail(connection, token, message)
      : sendMicrosoft(connection, token, message);
  }
}
