import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { hashToken } from "@/lib/auth";
import { isObject } from "@/utils/isObject";

type Queryable = Pick<Pool | PoolClient, "query">;

export const QUOTATION_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
] as const;

export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export type QuotationLineItem = {
  line_item_id: string;
  unit_id: string | null;
  category: "base_price" | "floor_premium" | "parking" | "amenity" | "other";
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  unit_code?: string | null;
  unit_name?: string | null;
  type_name?: string | null;
};

export type QuotationTax = {
  tax_id: string;
  label: string;
  rate: number;
  amount: number;
};

export type PaymentInstallment = {
  installment_id: string;
  label: string;
  percentage: number;
  amount: number;
  due_date: string | null;
  trigger: string | null;
};

export type QuotationInput = {
  title: string;
  currency: string;
  valid_until: string | null;
  line_items: QuotationLineItem[];
  discount_type: "percentage" | "fixed" | null;
  discount_value: number;
  tax_breakdown: QuotationTax[];
  payment_plan: {
    template_key: string;
    template_name: string;
    installments: PaymentInstallment[];
  };
  terms_and_conditions: string | null;
  customer_message: string | null;
  notes: string | null;
};

export type QuotationAmounts = {
  subtotal: number;
  chargesTotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  taxes: QuotationTax[];
  paymentPlan: QuotationInput["payment_plan"];
};

function rounded(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function boundedText(
  value: unknown,
  field: string,
  errors: string[],
  maximum: number,
  required = false,
) {
  if (value === undefined || value === null) {
    if (required) errors.push(`${field} is required`);
    return value === null ? null : undefined;
  }
  if (typeof value !== "string") {
    errors.push(`${field} must be text`);
    return undefined;
  }
  const result = value.trim();
  if (required && !result) errors.push(`${field} cannot be empty`);
  if (result.length > maximum)
    errors.push(`${field} cannot exceed ${maximum} characters`);
  return result || null;
}

function finiteNumber(
  value: unknown,
  field: string,
  errors: string[],
  minimum = 0,
) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum) {
    errors.push(`${field} must be a number of at least ${minimum}`);
    return 0;
  }
  return result;
}

function normalizeLineItems(value: unknown, errors: string[]) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    errors.push("line_items must contain between 1 and 100 items");
    return [] as QuotationLineItem[];
  }
  const categories = new Set([
    "base_price",
    "floor_premium",
    "parking",
    "amenity",
    "other",
  ]);
  return value.map((raw, index) => {
    const item = isObject(raw) && !Array.isArray(raw) ? raw : {};
    if (!isObject(raw) || Array.isArray(raw))
      errors.push(`line_items[${index}] must be an object`);
    const description = boundedText(
      item.description ?? item.unit_name ?? item.unit_code,
      `line_items[${index}].description`,
      errors,
      500,
      true,
    );
    const category = categories.has(String(item.category))
      ? (String(item.category) as QuotationLineItem["category"])
      : "other";
    const quantity = finiteNumber(
      item.quantity ?? 1,
      `line_items[${index}].quantity`,
      errors,
      0.01,
    );
    const unitPrice = finiteNumber(
      item.unit_price ?? item.amount,
      `line_items[${index}].unit_price`,
      errors,
    );
    const unitId =
      item.unit_id === undefined || item.unit_id === null
        ? null
        : typeof item.unit_id === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              item.unit_id,
            )
          ? item.unit_id.toLowerCase()
          : (errors.push(`line_items[${index}].unit_id must be a UUID or null`),
            null);
    return {
      line_item_id:
        typeof item.line_item_id === "string" && item.line_item_id.length <= 100
          ? item.line_item_id
          : randomUUID(),
      unit_id: unitId,
      category,
      description: String(description ?? "Line item"),
      quantity: rounded(quantity),
      unit_price: rounded(unitPrice),
      amount: rounded(quantity * unitPrice),
      unit_code:
        typeof item.unit_code === "string"
          ? item.unit_code.slice(0, 200)
          : null,
      unit_name:
        typeof item.unit_name === "string"
          ? item.unit_name.slice(0, 250)
          : null,
      type_name:
        typeof item.type_name === "string"
          ? item.type_name.slice(0, 250)
          : null,
    } satisfies QuotationLineItem;
  });
}

function normalizeTaxes(value: unknown, errors: string[]) {
  if (value === undefined) return [] as QuotationTax[];
  if (!Array.isArray(value) || value.length > 20) {
    errors.push("tax_breakdown must be an array with no more than 20 taxes");
    return [] as QuotationTax[];
  }
  return value.map((raw, index) => {
    const tax = isObject(raw) && !Array.isArray(raw) ? raw : {};
    if (!isObject(raw) || Array.isArray(raw))
      errors.push(`tax_breakdown[${index}] must be an object`);
    const label = boundedText(
      tax.label,
      `tax_breakdown[${index}].label`,
      errors,
      100,
      true,
    );
    const rate = finiteNumber(tax.rate, `tax_breakdown[${index}].rate`, errors);
    if (rate > 100)
      errors.push(`tax_breakdown[${index}].rate cannot exceed 100`);
    return {
      tax_id:
        typeof tax.tax_id === "string" && tax.tax_id.length <= 100
          ? tax.tax_id
          : randomUUID(),
      label: String(label ?? "Tax"),
      rate: rounded(rate),
      amount: 0,
    } satisfies QuotationTax;
  });
}

function normalizePaymentPlan(
  value: unknown,
  errors: string[],
): QuotationInput["payment_plan"] {
  if (value === undefined || value === null) {
    return {
      template_key: "full",
      template_name: "Full payment",
      installments: [],
    };
  }
  if (!isObject(value) || Array.isArray(value)) {
    errors.push("payment_plan must be an object");
    return {
      template_key: "custom",
      template_name: "Custom",
      installments: [],
    };
  }
  const rawInstallments = Array.isArray(value.installments)
    ? value.installments
    : [];
  if (!Array.isArray(value.installments) || rawInstallments.length > 50)
    errors.push("payment_plan.installments must contain no more than 50 items");
  const installments = rawInstallments.map((raw, index) => {
    const installment = isObject(raw) && !Array.isArray(raw) ? raw : {};
    if (!isObject(raw) || Array.isArray(raw))
      errors.push(`payment_plan.installments[${index}] must be an object`);
    const label = boundedText(
      installment.label,
      `payment_plan.installments[${index}].label`,
      errors,
      150,
      true,
    );
    const percentage = finiteNumber(
      installment.percentage,
      `payment_plan.installments[${index}].percentage`,
      errors,
    );
    if (percentage > 100)
      errors.push(
        `payment_plan.installments[${index}].percentage cannot exceed 100`,
      );
    const dueDate = installment.due_date;
    if (
      dueDate !== undefined &&
      dueDate !== null &&
      (typeof dueDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
        Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`)))
    )
      errors.push(
        `payment_plan.installments[${index}].due_date must be YYYY-MM-DD or null`,
      );
    return {
      installment_id:
        typeof installment.installment_id === "string" &&
        installment.installment_id.length <= 100
          ? installment.installment_id
          : randomUUID(),
      label: String(label ?? `Installment ${index + 1}`),
      percentage: rounded(percentage),
      amount: 0,
      due_date: typeof dueDate === "string" ? dueDate : null,
      trigger:
        typeof installment.trigger === "string"
          ? installment.trigger.trim().slice(0, 250) || null
          : null,
    } satisfies PaymentInstallment;
  });
  if (
    installments.length &&
    Math.abs(
      installments.reduce((sum, item) => sum + item.percentage, 0) - 100,
    ) > 0.01
  )
    errors.push("Payment-plan installment percentages must total 100");
  return {
    template_key:
      typeof value.template_key === "string"
        ? value.template_key.slice(0, 100)
        : "custom",
    template_name:
      typeof value.template_name === "string"
        ? value.template_name.slice(0, 150)
        : "Custom",
    installments,
  };
}

export function validateQuotationInput(
  body: unknown,
):
  | { ok: true; data: QuotationInput; amounts: QuotationAmounts }
  | { ok: false; errors: string[] } {
  if (!isObject(body) || Array.isArray(body))
    return { ok: false, errors: ["Request body must be a JSON object"] };
  const errors: string[] = [];
  const title = boundedText(body.title, "title", errors, 250, true);
  const currency =
    typeof body.currency === "string"
      ? body.currency.trim().toUpperCase()
      : "INR";
  if (!/^[A-Z]{3}$/.test(currency))
    errors.push("currency must be a three-letter ISO code");
  const validUntil = body.valid_until;
  if (
    validUntil !== undefined &&
    validUntil !== null &&
    (typeof validUntil !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(validUntil) ||
      Number.isNaN(Date.parse(`${validUntil}T00:00:00Z`)))
  )
    errors.push("valid_until must be a valid YYYY-MM-DD date or null");
  const lineItems = normalizeLineItems(body.line_items, errors);
  const discountType =
    body.discount_type === null || body.discount_type === undefined
      ? null
      : body.discount_type === "percentage" || body.discount_type === "fixed"
        ? body.discount_type
        : (errors.push("discount_type must be percentage, fixed or null"),
          null);
  const discountValue = finiteNumber(
    body.discount_value ?? 0,
    "discount_value",
    errors,
  );
  if (discountType === "percentage" && discountValue > 100)
    errors.push("A percentage discount cannot exceed 100");
  const taxes = normalizeTaxes(body.tax_breakdown, errors);
  const paymentPlan = normalizePaymentPlan(body.payment_plan, errors);
  const terms = boundedText(
    body.terms_and_conditions,
    "terms_and_conditions",
    errors,
    50000,
  );
  const message = boundedText(
    body.customer_message,
    "customer_message",
    errors,
    10000,
  );
  const notes = boundedText(body.notes, "notes", errors, 10000);
  const input: QuotationInput = {
    title: String(title ?? "Quotation"),
    currency,
    valid_until: typeof validUntil === "string" ? validUntil : null,
    line_items: lineItems,
    discount_type: discountType,
    discount_value: rounded(discountValue),
    tax_breakdown: taxes,
    payment_plan: paymentPlan,
    terms_and_conditions: terms ?? null,
    customer_message: message ?? null,
    notes: notes ?? null,
  };
  const amounts = calculateQuotation(input);
  if (amounts.discountAmount > amounts.subtotal)
    errors.push("discount cannot exceed the quotation subtotal");
  return errors.length
    ? { ok: false, errors }
    : { ok: true, data: input, amounts };
}

export function calculateQuotation(input: QuotationInput): QuotationAmounts {
  const subtotal = rounded(
    input.line_items.reduce((sum, item) => sum + item.amount, 0),
  );
  const chargesTotal = rounded(
    input.line_items
      .filter((item) => item.category !== "base_price")
      .reduce((sum, item) => sum + item.amount, 0),
  );
  const discountAmount = rounded(
    input.discount_type === "percentage"
      ? subtotal * (input.discount_value / 100)
      : input.discount_type === "fixed"
        ? input.discount_value
        : 0,
  );
  const taxable = Math.max(0, rounded(subtotal - discountAmount));
  const taxes = input.tax_breakdown.map((tax) => ({
    ...tax,
    amount: rounded(taxable * (tax.rate / 100)),
  }));
  const taxAmount = rounded(taxes.reduce((sum, tax) => sum + tax.amount, 0));
  const totalAmount = rounded(taxable + taxAmount);
  const paymentPlan = {
    ...input.payment_plan,
    installments: input.payment_plan.installments.map((installment) => ({
      ...installment,
      amount: rounded(totalAmount * (installment.percentage / 100)),
    })),
  };
  return {
    subtotal,
    chargesTotal,
    discountAmount,
    taxAmount,
    totalAmount,
    taxes,
    paymentPlan,
  };
}

export async function getQuotationDetail(
  database: Queryable,
  quotationId: string,
  opportunityId?: string,
) {
  const result = await database.query(
    `SELECT quotation.*,
       opportunity.opportunity_name, opportunity.contact_id, opportunity.lead_id,
       project.project_name, project.project_code,
       company.company_name, company.company_legal_name,
       company.company_phone_number, company.company_contact_email,
       contact.first_name, contact.last_name, contact.email AS contact_email,
       contact.phone_number AS contact_phone_number,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'conversion_id', conversion.conversion_id,
           'target_type', conversion.target_type,
           'status', conversion.status,
           'reservation_id', conversion.reservation_id,
           'created_at', conversion.created_at,
           'completed_at', conversion.completed_at
         ) ORDER BY conversion.created_at)
         FROM quotation_conversions conversion
         WHERE conversion.quotation_id=quotation.quotation_id
       ), '[]'::jsonb) AS conversions
     FROM opportunity_quotations quotation
     JOIN opportunities opportunity ON opportunity.opportunity_id=quotation.opportunity_id
     JOIN projects project ON project.project_id=quotation.project_id
     JOIN companies company ON company.company_id=quotation.company_id
     JOIN contacts contact ON contact.contact_id=opportunity.contact_id
     WHERE quotation.quotation_id=$1
       AND ($2::uuid IS NULL OR quotation.opportunity_id=$2)`,
    [quotationId, opportunityId ?? null],
  );
  return result.rows[0] ?? null;
}

export async function recordQuotationEvent(
  database: Queryable,
  quotation: Record<string, unknown>,
  eventType: string,
  options: {
    actorUserId?: string | null;
    actorName?: string | null;
    actorEmail?: string | null;
    comment?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
) {
  await database.query(
    `INSERT INTO opportunity_quotation_events (
       company_id,project_id,opportunity_id,quotation_id,event_type,
       actor_user_id,actor_name,actor_email,comment,metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [
      quotation.company_id,
      quotation.project_id,
      quotation.opportunity_id,
      quotation.quotation_id,
      eventType,
      options.actorUserId ?? null,
      options.actorName ?? null,
      options.actorEmail ?? null,
      options.comment ?? null,
      JSON.stringify(options.metadata ?? {}),
    ],
  );
}

export function createQuotationShareToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function quotationShareUrl(token: string, origin: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return `${configured || origin}/quote/${encodeURIComponent(token)}`;
}

export async function issueQuotationShareLink(
  database: Queryable,
  quotation: Record<string, unknown>,
  options: {
    createdBy: string;
    recipientEmail?: string | null;
    validityDays?: number;
  },
) {
  const { token, tokenHash } = createQuotationShareToken();
  const days = Math.min(90, Math.max(1, options.validityDays ?? 30));
  const result = await database.query(
    `INSERT INTO quotation_share_links (
       company_id,project_id,quotation_id,token_hash,recipient_email,
       expires_at,created_by
     ) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP + ($6 * INTERVAL '1 day'),$7)
     RETURNING share_link_id,expires_at`,
    [
      quotation.company_id,
      quotation.project_id,
      quotation.quotation_id,
      tokenHash,
      options.recipientEmail ?? null,
      days,
      options.createdBy,
    ],
  );
  return { token, ...result.rows[0] };
}

export function safePublicQuotation(quotation: Record<string, unknown>) {
  return {
    quotation_number: quotation.quotation_number,
    version: quotation.version,
    title: quotation.title,
    status: quotation.status,
    currency: quotation.currency,
    subtotal: quotation.subtotal,
    charges_total: quotation.charges_total,
    discount_type: quotation.discount_type,
    discount_value: quotation.discount_value,
    discount_amount: quotation.discount_amount,
    tax_amount: quotation.tax_amount,
    total_amount: quotation.total_amount,
    valid_until: quotation.valid_until,
    line_items: quotation.line_items,
    tax_breakdown: quotation.tax_breakdown,
    payment_plan: quotation.payment_plan,
    terms_and_conditions: quotation.terms_and_conditions,
    customer_message: quotation.customer_message,
    notes: quotation.notes,
    sent_at: quotation.sent_at,
    viewed_at: quotation.viewed_at,
    accepted_at: quotation.accepted_at,
    rejected_at: quotation.rejected_at,
    opportunity_name: quotation.opportunity_name,
    project_name: quotation.project_name,
    project_code: quotation.project_code,
    company_name: quotation.company_name,
    company_legal_name: quotation.company_legal_name,
    company_phone_number: quotation.company_phone_number,
    company_contact_email: quotation.company_contact_email,
    customer: {
      first_name: quotation.first_name,
      last_name: quotation.last_name,
      email: quotation.contact_email,
      phone_number: quotation.contact_phone_number,
    },
  };
}

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
