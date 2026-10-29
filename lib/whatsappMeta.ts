import { decryptWhatsAppToken, templateTextParameters } from "@/lib/whatsapp";

type MetaError = { error?: { message?: string; code?: number; error_subcode?: number } };

function graphVersion() {
  return process.env.META_GRAPH_API_VERSION?.trim() || "v24.0";
}
function graphUrl(path: string) {
  return `https://graph.facebook.com/${graphVersion()}/${path.replace(/^\//, "")}`;
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  try { payload = raw ? JSON.parse(raw) as Record<string, unknown> : {}; }
  catch { payload = { raw: raw.slice(0, 2000) }; }
  if (!response.ok) {
    const error = payload as MetaError;
    throw new Error(`Meta WhatsApp ${response.status}: ${error.error?.message || raw || "Request failed"}`.slice(0, 1200));
  }
  return payload;
}

export async function exchangeEmbeddedSignupCode(code: string, redirectUri?: string) {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) throw new Error("Meta WhatsApp application credentials are not configured");
  const query = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
  if (redirectUri) query.set("redirect_uri", redirectUri);
  const response = await fetch(`${graphUrl("oauth/access_token")}?${query}`, { cache: "no-store" });
  const payload = await parseResponse(response);
  const token = typeof payload.access_token === "string" ? payload.access_token : null;
  if (!token) throw new Error("Meta did not return an access token");
  return { accessToken: token, expiresIn: Number(payload.expires_in || 0) || null };
}

export async function subscribeWhatsAppApp(wabaId: string, accessToken: string) {
  const response = await fetch(graphUrl(`${encodeURIComponent(wabaId)}/subscribed_apps`), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  return parseResponse(response);
}
export async function getWhatsAppPhoneNumber(phoneNumberId: string, accessToken: string) {
  const query = new URLSearchParams({ fields: "id,display_phone_number,verified_name,quality_rating" });
  const response = await fetch(`${graphUrl(encodeURIComponent(phoneNumberId))}?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  return parseResponse(response);
}

export async function listMetaTemplates(wabaId: string, encryptedToken: string) {
  const query = new URLSearchParams({ fields: "id,name,language,status,category,components,rejected_reason", limit: "250" });
  const response = await fetch(`${graphUrl(`${encodeURIComponent(wabaId)}/message_templates`)}?${query}`, {
    headers: { Authorization: `Bearer ${decryptWhatsAppToken(encryptedToken)}` },
    cache: "no-store",
  });
  return parseResponse(response);
}

export async function createMetaTemplate(args: {
  wabaId: string;
  encryptedToken: string;
  name: string;
  language: string;
  category: string;
  components: unknown[];
}) {
  const response = await fetch(graphUrl(`${encodeURIComponent(args.wabaId)}/message_templates`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${decryptWhatsAppToken(args.encryptedToken)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: args.name, language: args.language, category: args.category, components: args.components }),
    cache: "no-store",
  });
  return parseResponse(response);
}

export async function editMetaTemplate(args: {
  metaTemplateId: string;
  encryptedToken: string;
  category: string;
  components: unknown[];
}) {
  const response = await fetch(graphUrl(encodeURIComponent(args.metaTemplateId)), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${decryptWhatsAppToken(args.encryptedToken)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ category: args.category, components: args.components }),
    cache: "no-store",
  });
  return parseResponse(response);
}

export async function sendMetaWhatsAppMessage(args: {
  phoneNumberId: string;
  encryptedToken: string;
  to: string;
  body?: string | null;
  template?: { name: string; language: string; parameters?: unknown } | null;
}) {
  const message = args.template
    ? {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: args.to,
        type: "template",
        template: {
          name: args.template.name,
          language: { code: args.template.language },
          ...(templateTextParameters(args.template.parameters).length
            ? { components: [{ type: "body", parameters: templateTextParameters(args.template.parameters) }] }
            : {}),
        },
      }
    : {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: args.to,
        type: "text",
        text: { preview_url: false, body: args.body },
      };
  const response = await fetch(graphUrl(`${encodeURIComponent(args.phoneNumberId)}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${decryptWhatsAppToken(args.encryptedToken)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
    cache: "no-store",
  });
  return parseResponse(response);
}
