import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingAmountFromPaymentPlan,
  createBookingCommercialSnapshot,
  validateBookingSubmission,
} from "../lib/bookingForms";

test("booking amount prefers the installment explicitly labelled for booking", () => {
  const result = bookingAmountFromPaymentPlan(
    {
      installments: [
        { label: "Agreement payment", amount: 500_000, percentage: 5 },
        { label: "Booking amount", amount: 1_500_000, percentage: 15 },
      ],
    },
    10_000_000,
  );
  assert.equal(result, 1_500_000);
});

test("booking amount is calculated from percentage when an amount is absent", () => {
  const result = bookingAmountFromPaymentPlan(
    { installments: [{ label: "Booking", percentage: 10 }] },
    22_650_000,
  );
  assert.equal(result, 2_265_000);
});

test("commercial booking fields are derived from the accepted quotation and unit", () => {
  const result = createBookingCommercialSnapshot({
    quotation: {
      total_amount: "22650000.00",
      currency: "inr",
      payment_plan: {
        template_name: "10 / 90",
        installments: [
          { label: "Booking amount", amount: 2_265_000, percentage: 10 },
        ],
      },
    },
    unit: {
      configuration: "3 BHK",
      type_name: "Premium apartment",
      unit_code: "A-1204",
    },
  });
  assert.equal(result.configuration, "3 BHK");
  assert.equal(result.flatNumber, "A-1204");
  assert.equal(result.agreedPrice, 22_650_000);
  assert.equal(result.bookingAmount, 2_265_000);
  assert.equal(result.currency, "INR");
});

test("booking submission requires contact details and explicit confirmation", () => {
  const invalid = validateBookingSubmission({
    name: "Customer",
    phone: "123",
    confirmed: false,
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.ok(invalid.errors.includes("Enter a valid phone number"));
    assert.ok(
      invalid.errors.includes("Confirm that the booking details are correct"),
    );
  }

  const valid = validateBookingSubmission({
    name: "  Customer Name ",
    phone: " +91 98765 43210 ",
    confirmed: true,
  });
  assert.deepEqual(valid, {
    ok: true,
    data: { name: "Customer Name", phone: "+91 98765 43210" },
  });
});
