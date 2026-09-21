import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export const CONSENT_CHANNELS = [
  "email",
  "sms",
  "phone",
  "whatsapp",
  "push",
] as const;

export const CONSENT_COLUMNS = `
  consent_id,
  contact_id,
  consent_type,
  channel,
  status,
  legal_basis,
  source,
  notes,
  granted_at,
  expires_at,
  withdrawn_at,
  created_at,
  updated_at
`;

type ConsentWrite = {
  consent_type: string;
  channel: (typeof CONSENT_CHANNELS)[number];
  legal_basis?: string | null;
  source?: string | null;
  notes?: string | null;
  expires_at?: string | null;
};

type Result =
  | { ok: true; data: ConsentWrite }
  | { ok: false; errors: string[] };

export function validateConsentPayload(body: unknown): Result {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const fields = [
    "consent_type",
    "channel",
    "legal_basis",
    "source",
    "notes",
    "expires_at",
  ];
  const allowed = new Set(fields);
  const errors = Object.keys(body)
    .filter((field) => !allowed.has(field))
    .map((field) => `Unknown field: ${field}`);

  const consentType = validateText(
    body.consent_type,
    "consent_type",
    50,
    false,
    errors,
  );
  const channel =
    typeof body.channel === "string"
      ? body.channel.toLowerCase()
      : body.channel;
  if (
    !CONSENT_CHANNELS.includes(channel as (typeof CONSENT_CHANNELS)[number])
  ) {
    errors.push(`channel must be one of: ${CONSENT_CHANNELS.join(", ")}`);
  }
  const legalBasis = validateText(
    body.legal_basis,
    "legal_basis",
    100,
    true,
    errors,
  );
  const source = validateText(body.source, "source", 100, true, errors);
  const notes = validateText(body.notes, "notes", 5000, true, errors);

  let expiresAt: string | null | undefined;
  if (body.expires_at === null) {
    expiresAt = null;
  } else if (body.expires_at !== undefined) {
    if (
      typeof body.expires_at !== "string" ||
      Number.isNaN(Date.parse(body.expires_at))
    ) {
      errors.push("expires_at must be a valid ISO date-time or null");
    } else if (new Date(body.expires_at).getTime() <= Date.now()) {
      errors.push("expires_at must be in the future");
    } else {
      expiresAt = new Date(body.expires_at).toISOString();
    }
  }
  if (body.consent_type === undefined) {
    errors.push("consent_type is required");
  }
  if (body.channel === undefined) {
    errors.push("channel is required");
  }

  if (
    errors.length ||
    typeof consentType !== "string" ||
    typeof channel !== "string"
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    data: {
      consent_type: consentType.toLowerCase(),
      channel: channel as ConsentWrite["channel"],
      ...(legalBasis !== undefined ? { legal_basis: legalBasis } : {}),
      ...(source !== undefined ? { source } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
    },
  };
}

export function parseConsentId(value: string): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}
