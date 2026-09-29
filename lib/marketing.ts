import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { adminPool } from "@/lib/db";
import { createIntakeEvent, processIntakeEvent } from "@/lib/leadIntake";
import { isObject } from "@/utils/isObject";

type MarketingDatabase = Pick<Pool, "query">;

export type PublicMarketingForm = {
  form_id: string;
  company_id: number;
  project_id: number;
  integration_id: string | null;
  source_id: string | null;
  campaign_id: string | null;
  form_name: string;
  provider: string;
  public_key: string;
  provider_form_id: string | null;
  submission_secret_hash: string | null;
  webhook_secret_hash: string | null;
  allowed_origins: string[];
  field_mapping: Record<string, unknown>;
  lead_defaults: Record<string, unknown>;
  consent_notice: string | null;
  is_active: boolean;
};

export type MarketingAttribution = {
  anonymous_visitor_id?: string | null;
  session_id?: string | null;
  event_type?: string;
  channel?: string | null;
  medium?: string | null;
  occurred_at?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  fbclid?: string | null;
  external_campaign_id?: string | null;
  external_ad_group_id?: string | null;
  external_creative_id?: string | null;
  external_form_id?: string | null;
  landing_page_url?: string | null;
  referrer_url?: string | null;
  ad_user_data_consent?: "granted" | "denied" | "unknown" | null;
  ad_personalization_consent?: "granted" | "denied" | "unknown" | null;
};

type SubmissionInput = {
  idempotencyKey: string;
  providerEventId?: string | null;
  contact: Record<string, unknown>;
  lead?: Record<string, unknown>;
  attribution?: MarketingAttribution;
  metadata?: Record<string, unknown>;
};

const CONTACT_FIELDS = new Set([
  "first_name",
  "last_name",
  "phone_number",
  "alternate_phone_number",
  "email",
  "country",
  "company_works_at",
  "address",
]);

const LEAD_FIELDS = new Set([
  "sub_source",
  "temperature",
  "customer_type",
  "current_owner_user_id",
  "current_team_id",
  "preferred_location",
  "preferred_config",
  "preferred_facing",
  "preferred_floor",
  "preferred_view",
  "budget",
  "buying_reason",
  "qualification_data",
  "tag_ids",
]);

function marketingHashSecret() {
  const secret =
    process.env.MARKETING_HASH_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "MARKETING_HASH_SECRET or AUTH_SECRET must contain at least 32 characters",
    );
  }
  return secret;
}

export function createMarketingSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashMarketingSecret(value: string) {
  return createHmac("sha256", marketingHashSecret())
    .update(value)
    .digest("hex");
}

export function verifyMarketingSecret(
  value: string | null | undefined,
  expectedHash: string | null | undefined,
) {
  if (!value || !expectedHash) return false;
  const actual = Buffer.from(hashMarketingSecret(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function marketingSubjectHash(value: string) {
  return hashMarketingSecret(`subject:${value}`);
}

function text(
  value: unknown,
  max: number,
  options: { required?: boolean } = {},
) {
  if (value === undefined || value === null || value === "") {
    if (options.required) throw new Error("A required value is missing");
    return null;
  }
  if (typeof value !== "string") throw new Error("Expected a text value");
  const normalized = value.trim();
  if (!normalized && options.required) throw new Error("A required value is missing");
  return normalized.slice(0, max) || null;
}

function validTimestamp(value: unknown) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function cleanRecord(
  value: unknown,
  allowed: Set<string>,
): Record<string, unknown> {
  if (!isObject(value) || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, item]) => allowed.has(key) && item !== undefined),
  );
}

export async function getPublicMarketingForm(
  publicKey: string,
  database: MarketingDatabase = adminPool,
): Promise<PublicMarketingForm | null> {
  const result = await database.query(
    `SELECT form_id, company_id, project_id, integration_id, source_id,
            campaign_id, form_name, provider, public_key::text, provider_form_id,
            submission_secret_hash, webhook_secret_hash, allowed_origins,
            field_mapping, lead_defaults, consent_notice, is_active
     FROM marketing_forms
     WHERE public_key::text=$1 AND is_active=TRUE`,
    [publicKey.toLowerCase()],
  );
  return (result.rows[0] as PublicMarketingForm | undefined) ?? null;
}

export function isAllowedMarketingOrigin(
  form: PublicMarketingForm,
  origin: string | null,
) {
  if (!origin) return false;
  let normalized: string;
  try {
    normalized = new URL(origin).origin.toLowerCase();
  } catch {
    return false;
  }
  return form.allowed_origins.some((allowed) => {
    const candidate = allowed.trim().toLowerCase().replace(/\/$/, "");
    if (candidate === normalized) return true;
    if (!candidate.startsWith("*.")) return false;
    try {
      const host = new URL(normalized).hostname;
      const suffix = candidate.slice(2);
      return host !== suffix && host.endsWith(`.${suffix}`);
    } catch {
      return false;
    }
  });
}

export async function consumeMarketingRateLimit(args: {
  formId: string;
  subjectHash: string;
  action: "track" | "submit" | "webhook";
  limit: number;
}) {
  const result = await adminPool.query(
    `INSERT INTO marketing_ingestion_limits (
       form_id, subject_hash, action, bucket_started_at, request_count
     ) VALUES ($1,$2,$3,DATE_TRUNC('minute',CURRENT_TIMESTAMP),1)
     ON CONFLICT (form_id, subject_hash, action, bucket_started_at)
     DO UPDATE SET request_count=marketing_ingestion_limits.request_count+1,
                   updated_at=CURRENT_TIMESTAMP
     RETURNING request_count`,
    [args.formId, args.subjectHash, args.action],
  );
  return Number(result.rows[0]?.request_count ?? 1) <= args.limit;
}

function normalizeAttribution(value: unknown): MarketingAttribution {
  if (!isObject(value) || Array.isArray(value)) return {};
  const consent = new Set(["granted", "denied", "unknown"]);
  const result: MarketingAttribution = {
    anonymous_visitor_id: text(value.anonymous_visitor_id, 200),
    session_id: text(value.session_id, 200),
    event_type: text(value.event_type, 50) ?? undefined,
    channel: text(value.channel, 80),
    medium: text(value.medium, 120),
    occurred_at: validTimestamp(value.occurred_at),
    utm_source: text(value.utm_source, 300),
    utm_medium: text(value.utm_medium, 300),
    utm_campaign: text(value.utm_campaign, 300),
    utm_term: text(value.utm_term, 500),
    utm_content: text(value.utm_content, 500),
    gclid: text(value.gclid, 500),
    gbraid: text(value.gbraid, 500),
    wbraid: text(value.wbraid, 500),
    fbclid: text(value.fbclid, 500),
    external_campaign_id: text(value.external_campaign_id, 200),
    external_ad_group_id: text(value.external_ad_group_id, 200),
    external_creative_id: text(value.external_creative_id, 200),
    external_form_id: text(value.external_form_id, 200),
    landing_page_url: text(value.landing_page_url, 5000),
    referrer_url: text(value.referrer_url, 5000),
    ad_user_data_consent:
      typeof value.ad_user_data_consent === "string" &&
      consent.has(value.ad_user_data_consent)
        ? (value.ad_user_data_consent as MarketingAttribution["ad_user_data_consent"])
        : null,
    ad_personalization_consent:
      typeof value.ad_personalization_consent === "string" &&
      consent.has(value.ad_personalization_consent)
        ? (value.ad_personalization_consent as MarketingAttribution["ad_personalization_consent"])
        : null,
  };
  return result;
}

async function insertTouchpoint(
  form: PublicMarketingForm,
  input: {
    idempotencyKey: string;
    providerEventId?: string | null;
    attribution?: MarketingAttribution;
    eventType: string;
    metadata?: Record<string, unknown>;
  },
) {
  const attribution = input.attribution ?? {};
  const provider =
    form.provider === "google_lead_form" ? "google_lead_form" : form.provider;
  const result = await adminPool.query(
    `INSERT INTO marketing_touchpoints (
       company_id, project_id, integration_id, form_id, source_id, campaign_id,
       anonymous_visitor_id, session_id, event_type, channel, medium, provider,
       provider_event_id, idempotency_key, occurred_at, utm_source, utm_medium,
       utm_campaign, utm_term, utm_content, gclid, gbraid, wbraid, fbclid,
       external_campaign_id, external_ad_group_id, external_creative_id,
       external_form_id, landing_page_url, referrer_url, ad_user_data_consent,
       ad_personalization_consent, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
       COALESCE($15::timestamptz,CURRENT_TIMESTAMP),$16,$17,$18,$19,$20,$21,$22,
       $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33::jsonb
     )
     ON CONFLICT (company_id, idempotency_key) DO NOTHING
     RETURNING *`,
    [
      form.company_id,
      form.project_id,
      form.integration_id,
      form.form_id,
      form.source_id,
      form.campaign_id,
      attribution.anonymous_visitor_id ?? null,
      attribution.session_id ?? null,
      input.eventType,
      attribution.channel ?? null,
      attribution.medium ?? null,
      provider,
      input.providerEventId ?? null,
      input.idempotencyKey,
      attribution.occurred_at ?? null,
      attribution.utm_source ?? null,
      attribution.utm_medium ?? null,
      attribution.utm_campaign ?? null,
      attribution.utm_term ?? null,
      attribution.utm_content ?? null,
      attribution.gclid ?? null,
      attribution.gbraid ?? null,
      attribution.wbraid ?? null,
      attribution.fbclid ?? null,
      attribution.external_campaign_id ?? null,
      attribution.external_ad_group_id ?? null,
      attribution.external_creative_id ?? null,
      attribution.external_form_id ?? form.provider_form_id,
      attribution.landing_page_url ?? null,
      attribution.referrer_url ?? null,
      attribution.ad_user_data_consent ?? null,
      attribution.ad_personalization_consent ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  if (result.rowCount) return { touchpoint: result.rows[0], created: true };
  const existing = await adminPool.query(
    `SELECT * FROM marketing_touchpoints
     WHERE company_id=$1 AND idempotency_key=$2`,
    [form.company_id, input.idempotencyKey],
  );
  return { touchpoint: existing.rows[0], created: false };
}

export async function recordMarketingTouchpoint(args: {
  form: PublicMarketingForm;
  idempotencyKey: string;
  eventType: string;
  attribution?: unknown;
  metadata?: Record<string, unknown>;
}) {
  const key = text(args.idempotencyKey, 220, { required: true });
  const eventType = text(args.eventType, 50, { required: true });
  if (!key || !eventType) throw new Error("event_id and event_type are required");
  return insertTouchpoint(args.form, {
    idempotencyKey: key,
    eventType,
    attribution: normalizeAttribution(args.attribution),
    metadata: args.metadata,
  });
}

export async function processMarketingSubmission(
  form: PublicMarketingForm,
  input: SubmissionInput,
) {
  const idempotencyKey = text(input.idempotencyKey, 220, { required: true });
  if (!idempotencyKey) throw new Error("event_id is required");
  const contact = cleanRecord(input.contact, CONTACT_FIELDS);
  const defaults = cleanRecord(form.lead_defaults, LEAD_FIELDS);
  const providedLead = cleanRecord(input.lead, LEAD_FIELDS);
  const lead = {
    ...defaults,
    ...providedLead,
    project_id: form.project_id,
    source_id: form.source_id,
    campaign_id: form.campaign_id,
    sub_source:
      providedLead.sub_source ?? defaults.sub_source ?? form.form_name,
  };
  const attribution = normalizeAttribution(input.attribution);
  const storedTouchpoint = await insertTouchpoint(form, {
    idempotencyKey,
    providerEventId: input.providerEventId,
    eventType: attribution.event_type ?? "form_submit",
    attribution,
    metadata: input.metadata,
  });
  const envelope = {
    idempotency_key: `marketing:${form.form_id}:${idempotencyKey}`,
    contact,
    lead,
  };
  const storedEvent = await createIntakeEvent(envelope, form.company_id, adminPool);
  const event = await processIntakeEvent(
    String(storedEvent.event.event_id),
    adminPool,
  );
  if (event.status !== "processed" || !event.lead_id) {
    return {
      accepted: true,
      duplicate: !storedEvent.created,
      status: event.status,
      event_id: event.event_id,
      touchpoint_id: storedTouchpoint.touchpoint?.touchpoint_id,
    };
  }
  const linked = await adminPool.query(
    `SELECT lead_id, contact_id FROM leads
     WHERE company_id=$1 AND lead_id=$2`,
    [form.company_id, event.lead_id],
  );
  const linkedLead = linked.rows[0];
  if (linkedLead) {
    await adminPool.query(
      `UPDATE marketing_touchpoints
       SET lead_id=$1, contact_id=$2
       WHERE company_id=$3
         AND (
           touchpoint_id=$4
           OR ($5::text IS NOT NULL AND anonymous_visitor_id=$5 AND lead_id IS NULL)
         )`,
      [
        linkedLead.lead_id,
        linkedLead.contact_id,
        form.company_id,
        storedTouchpoint.touchpoint.touchpoint_id,
        attribution.anonymous_visitor_id ?? null,
      ],
    );
    await adminPool.query(
      `INSERT INTO lead_attributions (
         lead_id, source_id, campaign_id, attribution_type, sub_source,
         occurred_at, metadata
       )
       SELECT $1,$2,$3,'first_touch',$4,$5::timestamptz,$6::jsonb
       WHERE ($2::uuid IS NOT NULL OR $3::uuid IS NOT NULL OR $4::text IS NOT NULL)
         AND NOT EXISTS (
           SELECT 1 FROM lead_attributions
           WHERE lead_id=$1 AND attribution_type='first_touch'
         )`,
      [
        linkedLead.lead_id,
        form.source_id,
        form.campaign_id,
        form.form_name,
        attribution.occurred_at ?? new Date().toISOString(),
        JSON.stringify({
          touchpoint_id: storedTouchpoint.touchpoint.touchpoint_id,
          utm_source: attribution.utm_source ?? null,
          utm_medium: attribution.utm_medium ?? null,
          utm_campaign: attribution.utm_campaign ?? null,
          gclid: attribution.gclid ?? null,
        }),
      ],
    );
  }
  return {
    accepted: true,
    duplicate: !storedEvent.created,
    status: event.status,
    event_id: event.event_id,
    lead_id: event.lead_id,
    touchpoint_id: storedTouchpoint.touchpoint.touchpoint_id,
  };
}

function mappedValue(
  payload: Record<string, unknown>,
  mapping: Record<string, unknown>,
  canonical: string,
) {
  const key = typeof mapping[canonical] === "string" ? String(mapping[canonical]) : canonical;
  return payload[key];
}

export function normalizeWebsiteSubmission(
  form: PublicMarketingForm,
  body: unknown,
): SubmissionInput {
  if (!isObject(body) || Array.isArray(body)) {
    throw new Error("Request body must be a JSON object");
  }
  if (body.website_url || body.company_website) {
    throw new Error("Submission rejected");
  }
  const fields = isObject(body.fields) && !Array.isArray(body.fields) ? body.fields : body;
  const mapping = form.field_mapping ?? {};
  const firstName = mappedValue(fields, mapping, "first_name");
  const fullName = mappedValue(fields, mapping, "full_name");
  let resolvedFirstName = firstName;
  let resolvedLastName = mappedValue(fields, mapping, "last_name");
  if (!resolvedFirstName && typeof fullName === "string") {
    const parts = fullName.trim().split(/\s+/);
    resolvedFirstName = parts.shift();
    resolvedLastName = parts.join(" ") || null;
  }
  return {
    idempotencyKey:
      text(body.event_id ?? body.idempotency_key, 220) ??
      createMarketingSecret(18),
    contact: {
      first_name: resolvedFirstName,
      last_name: resolvedLastName,
      email: mappedValue(fields, mapping, "email"),
      phone_number: mappedValue(fields, mapping, "phone_number"),
      country: mappedValue(fields, mapping, "country"),
      company_works_at: mappedValue(fields, mapping, "company_works_at"),
      address: mappedValue(fields, mapping, "address"),
    },
    lead: {
      preferred_location: mappedValue(fields, mapping, "preferred_location"),
      preferred_config: mappedValue(fields, mapping, "preferred_config"),
      budget:
        typeof mappedValue(fields, mapping, "budget") === "number"
          ? mappedValue(fields, mapping, "budget")
          : undefined,
      buying_reason: mappedValue(fields, mapping, "buying_reason"),
    },
    attribution: normalizeAttribution(body.attribution),
    metadata: { ingestion: "website_form" },
  };
}

export function normalizeGoogleLeadSubmission(
  form: PublicMarketingForm,
  body: unknown,
): SubmissionInput {
  if (!isObject(body) || Array.isArray(body)) {
    throw new Error("Request body must be a JSON object");
  }
  const leadId = text(body.lead_id, 220, { required: true });
  if (!leadId) throw new Error("lead_id is required");
  const values = new Map<string, unknown>();
  if (Array.isArray(body.column_data)) {
    for (const column of body.column_data) {
      if (!isObject(column) || Array.isArray(column)) continue;
      const name = String(column.column_id ?? column.column_name ?? "").toUpperCase();
      values.set(name, column.string_value ?? column.value ?? null);
    }
  }
  const fullName = values.get("FULL_NAME");
  let firstName = values.get("FIRST_NAME");
  let lastName = values.get("LAST_NAME");
  if (!firstName && typeof fullName === "string") {
    const parts = fullName.trim().split(/\s+/);
    firstName = parts.shift();
    lastName = parts.join(" ") || null;
  }
  const campaignId = text(body.campaign_id, 200);
  const formId = text(body.form_id, 200);
  return {
    idempotencyKey: `google:${leadId}`,
    providerEventId: leadId,
    contact: {
      first_name: firstName,
      last_name: lastName,
      email: values.get("EMAIL"),
      phone_number: values.get("PHONE_NUMBER"),
      address: values.get("CITY"),
    },
    lead: {
      preferred_location: values.get("PREFERRED_LOCATION"),
      preferred_config: values.get("PROPERTY_TYPE"),
      buying_reason: values.get("PURCHASE_TIMELINE"),
    },
    attribution: {
      event_type: "lead_generated",
      channel: "paid_search",
      medium: "cpc",
      utm_source: "google",
      external_campaign_id: campaignId,
      external_form_id: formId,
      occurred_at: validTimestamp(body.lead_submit_time),
    },
    metadata: {
      ingestion: "google_lead_form",
      api_version: text(body.api_version, 40),
      is_test: body.is_test === true,
    },
  };
}

export async function queueMarketingConversion(
  client: PoolClient,
  args: {
    companyId: number;
    projectId: number;
    eventName: "lead_qualified" | "site_visit_completed" | "booking_confirmed" | "opportunity_won";
    transactionId: string;
    leadId?: string | null;
    opportunityId?: string | null;
    value?: number | null;
    currency?: string | null;
    eventTimestamp?: Date;
  },
) {
  await client.query(
    `INSERT INTO marketing_conversion_jobs (
       company_id, project_id, integration_id, touchpoint_id, contact_id,
       lead_id, opportunity_id, event_name, transaction_id, event_timestamp,
       conversion_value, currency, request_payload
     )
     SELECT $1,$2,integration.integration_id,touchpoint.touchpoint_id,
            COALESCE(touchpoint.contact_id,lead.contact_id),$3,$4,$5,$6,$7,$8,$9,
            JSONB_BUILD_OBJECT('conversion_action_id',
              integration.settings->'conversion_actions'->>$5)
     FROM marketing_integrations integration
     LEFT JOIN leads lead ON lead.lead_id=$3 AND lead.company_id=$1
     LEFT JOIN LATERAL (
       SELECT candidate.touchpoint_id, candidate.contact_id
       FROM marketing_touchpoints candidate
       WHERE candidate.company_id=$1
         AND ($3::uuid IS NULL OR candidate.lead_id=$3)
         AND (candidate.gclid IS NOT NULL OR candidate.gbraid IS NOT NULL OR candidate.wbraid IS NOT NULL)
       ORDER BY candidate.occurred_at DESC
       LIMIT 1
     ) touchpoint ON TRUE
     WHERE integration.company_id=$1
       AND integration.provider='google_data_manager'
       AND integration.status='connected'
       AND NULLIF(integration.settings->'conversion_actions'->>$5,'') IS NOT NULL
     ON CONFLICT (integration_id, event_name, transaction_id) DO NOTHING`,
    [
      args.companyId,
      args.projectId,
      args.leadId ?? null,
      args.opportunityId ?? null,
      args.eventName,
      args.transactionId,
      args.eventTimestamp ?? new Date(),
      args.value ?? null,
      args.currency?.toUpperCase() ?? null,
    ],
  );
}
