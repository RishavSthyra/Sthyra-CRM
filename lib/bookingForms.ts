import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { hashToken } from "@/lib/auth";
import { isObject } from "@/utils/isObject";

type Queryable = Pick<Pool | PoolClient, "query">;

type PaymentInstallment = {
  label?: unknown;
  amount?: unknown;
  percentage?: unknown;
};

export type BookingCommercialSnapshot = {
  configuration: string;
  flatNumber: string;
  agreedPrice: number;
  bookingAmount: number;
  currency: string;
  paymentPlan: Record<string, unknown>;
};

function finiteAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

export function bookingAmountFromPaymentPlan(
  paymentPlan: unknown,
  agreedPrice: number,
) {
  if (!isObject(paymentPlan) || Array.isArray(paymentPlan)) return 0;
  const installments = Array.isArray(paymentPlan.installments)
    ? (paymentPlan.installments as PaymentInstallment[])
    : [];
  if (!installments.length) return 0;
  const bookingInstallment =
    installments.find((item) =>
      String(item.label ?? "")
        .toLowerCase()
        .includes("booking"),
    ) ?? installments[0];
  const explicitAmount = finiteAmount(bookingInstallment.amount);
  if (explicitAmount > 0) return explicitAmount;
  const percentage = finiteAmount(bookingInstallment.percentage);
  return Math.round(agreedPrice * (percentage / 100) * 100) / 100;
}

export function createBookingCommercialSnapshot(input: {
  quotation: Record<string, unknown>;
  unit: Record<string, unknown>;
}): BookingCommercialSnapshot {
  const agreedPrice = finiteAmount(input.quotation.total_amount);
  const rawPlan = input.quotation.payment_plan;
  const paymentPlan =
    isObject(rawPlan) && !Array.isArray(rawPlan) ? rawPlan : {};
  return {
    configuration:
      String(input.unit.configuration ?? "").trim() ||
      String(input.unit.type_name ?? "").trim() ||
      String(input.unit.unit_name ?? "").trim() ||
      "Not specified",
    flatNumber:
      String(input.unit.unit_code ?? "").trim() ||
      String(input.unit.unit_name ?? "").trim() ||
      "Not specified",
    agreedPrice,
    bookingAmount: bookingAmountFromPaymentPlan(paymentPlan, agreedPrice),
    currency: String(input.quotation.currency ?? "INR").toUpperCase(),
    paymentPlan,
  };
}

export function createBookingFormToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function createBookingReference() {
  return `BF-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export function bookingFormUrl(token: string, origin: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return `${configured || origin}/booking/${encodeURIComponent(token)}`;
}

export function validateBookingSubmission(body: unknown):
  | { ok: true; data: { name: string; phone: string } }
  | { ok: false; errors: string[] } {
  if (!isObject(body) || Array.isArray(body))
    return { ok: false, errors: ["Request body must be a JSON object"] };
  const errors: string[] = [];
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!name) errors.push("Name is required");
  if (name.length > 250) errors.push("Name cannot exceed 250 characters");
  if (!phone) errors.push("Phone number is required");
  if (phone.length > 40) errors.push("Phone number cannot exceed 40 characters");
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15)
    errors.push("Enter a valid phone number");
  if (body.confirmed !== true)
    errors.push("Confirm that the booking details are correct");
  return errors.length
    ? { ok: false, errors }
    : { ok: true, data: { name, phone } };
}

export async function getBookingFormDetail(
  database: Queryable,
  quotationId: string,
  opportunityId?: string,
) {
  const result = await database.query(
    `SELECT form.*,
       quotation.quotation_number, quotation.version AS quotation_version,
       opportunity.opportunity_name, opportunity.stage_key, opportunity.status AS opportunity_status,
       project.project_name, project.project_code,
       company.company_name, company.company_legal_name,
       company.company_phone_number, company.company_contact_email
     FROM booking_forms form
     JOIN opportunity_quotations quotation ON quotation.quotation_id=form.quotation_id
     JOIN opportunities opportunity ON opportunity.opportunity_id=form.opportunity_id
     JOIN projects project ON project.project_id=form.project_id
     JOIN companies company ON company.company_id=form.company_id
     WHERE form.quotation_id=$1
       AND ($2::uuid IS NULL OR form.opportunity_id=$2)`,
    [quotationId, opportunityId ?? null],
  );
  return result.rows[0] ?? null;
}

export function safePublicBookingForm(form: Record<string, unknown>) {
  return {
    booking_reference: form.booking_reference,
    status: form.status,
    expires_at: form.expires_at,
    submitted_at: form.submitted_at,
    confirmed_at: form.confirmed_at,
    customer_name: form.customer_name,
    phone_number: form.phone_number,
    configuration: form.configuration,
    flat_number: form.flat_number,
    agreed_price: form.agreed_price,
    booking_amount: form.booking_amount,
    currency: form.currency,
    payment_plan: form.payment_plan,
    quotation_number: form.quotation_number,
    quotation_version: form.quotation_version,
    opportunity_name: form.opportunity_name,
    project_name: form.project_name,
    project_code: form.project_code,
    company_name: form.company_name,
    company_legal_name: form.company_legal_name,
    company_phone_number: form.company_phone_number,
    company_contact_email: form.company_contact_email,
  };
}
