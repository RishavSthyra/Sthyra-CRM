import assert from "node:assert/strict";
import test from "node:test";
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
