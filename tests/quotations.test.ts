import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { generateQuotationPdf } from "../lib/quotationPdf";
import {
  calculateQuotation,
  validateQuotationInput,
  type QuotationInput,
} from "../lib/quotations";

const baseInput: QuotationInput = {
  title: "Apartment 12A quotation",
  currency: "INR",
  valid_until: "2026-10-31",
  line_items: [
    {
      line_item_id: "base",
      unit_id: null,
      category: "base_price",
      description: "Base price",
      quantity: 1,
      unit_price: 10_000_000,
      amount: 10_000_000,
    },
    {
      line_item_id: "parking",
      unit_id: null,
      category: "parking",
      description: "Covered parking",
      quantity: 2,
      unit_price: 250_000,
      amount: 500_000,
    },
  ],
  discount_type: "percentage",
  discount_value: 10,
  tax_breakdown: [
    { tax_id: "gst", label: "GST", rate: 5, amount: 0 },
    { tax_id: "cess", label: "Cess", rate: 1, amount: 0 },
  ],
  payment_plan: {
    template_key: "twenty_eighty",
    template_name: "20 / 80 plan",
    installments: [
      {
        installment_id: "first",
        label: "Booking amount",
        percentage: 20,
        amount: 0,
        due_date: null,
        trigger: "On acceptance",
      },
      {
        installment_id: "balance",
        label: "Balance",
        percentage: 80,
        amount: 0,
        due_date: null,
        trigger: "Before handover",
      },
    ],
  },
  terms_and_conditions: "Subject to availability.",
  customer_message: null,
  notes: null,
};

test("quotation calculation itemizes charges, discounts, taxes and installments", () => {
  const result = calculateQuotation(baseInput);
  assert.equal(result.subtotal, 10_500_000);
  assert.equal(result.chargesTotal, 500_000);
  assert.equal(result.discountAmount, 1_050_000);
  assert.equal(result.taxAmount, 567_000);
  assert.equal(result.totalAmount, 10_017_000);
  assert.deepEqual(
    result.taxes.map((tax) => tax.amount),
    [472_500, 94_500],
  );
  assert.deepEqual(
    result.paymentPlan.installments.map((item) => item.amount),
    [2_003_400, 8_013_600],
  );
});

test("quotation validation rejects plans that do not total one hundred percent", () => {
  const result = validateQuotationInput({
    ...baseInput,
    payment_plan: {
      ...baseInput.payment_plan,
      installments: baseInput.payment_plan.installments.map((item) => ({
        ...item,
        percentage: 40,
      })),
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.ok(
      result.errors.includes(
        "Payment-plan installment percentages must total 100",
      ),
    );
});

test("quotation validation prevents a discount from exceeding subtotal", () => {
  const result = validateQuotationInput({
    ...baseInput,
    discount_type: "fixed",
    discount_value: 20_000_000,
  });
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.ok(
      result.errors.includes("discount cannot exceed the quotation subtotal"),
    );
});

test("quotation PDF renders a valid multi-page business document", async () => {
  const lineItems = Array.from({ length: 28 }, (_, index) => ({
    category: index === 0 ? "base_price" : "additional_charge",
    description:
      index === 0
        ? "Apartment base price"
        : `Additional charge ${index} with enough detail to exercise row wrapping`,
    quantity: index === 0 ? 1 : 2,
    unit_price: index === 0 ? 20_000_000 : 25_000,
    amount: index === 0 ? 20_000_000 : 50_000,
  }));

  const buffer = await generateQuotationPdf({
    company_name: "Abhigna Constructions",
    company_contact_email: "info@example.com",
    company_phone_number: "+91 90000 00000",
    quotation_number: "Q-TEST-01",
    version: 1,
    title: "Apartment quotation",
    created_at: "2026-10-07T00:00:00.000Z",
    valid_until: "2026-10-31",
    first_name: "Sample",
    last_name: "Customer",
    contact_email: "customer@example.com",
    contact_phone_number: "+91 91111 11111",
    project_name: "Aadhya Serene",
    project_code: "AADHYA_SERENE",
    currency: "INR",
    line_items: lineItems,
    subtotal: 21_350_000,
    discount_amount: 800_000,
    tax_amount: 3_699_000,
    total_amount: 24_249_000,
    tax_breakdown: [{ label: "GST", rate: 18, amount: 3_699_000 }],
    payment_plan: {
      template_name: "20 / 80 plan",
      installments: [
        {
          label: "Booking amount",
          percentage: 20,
          amount: 4_849_800,
          trigger: "On acceptance",
        },
        {
          label: "Balance payment",
          percentage: 80,
          amount: 19_399_200,
          trigger: "Before handover",
        },
      ],
    },
    customer_message: "Thank you for considering our project.",
    terms_and_conditions: "Prices and availability are subject to confirmation.",
  });

  assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
  const document = await PDFDocument.load(buffer);
  assert.ok(document.getPageCount() > 1);
  assert.equal(document.getTitle(), "Q-TEST-01 - Aadhya Serene");
});
