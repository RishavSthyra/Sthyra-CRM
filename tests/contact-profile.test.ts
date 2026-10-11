import assert from "node:assert/strict";
import test from "node:test";
import { validateContactProfilePayload } from "../lib/contacts";

test("contact profile accepts and normalizes personal and residence details", () => {
  const result = validateContactProfilePayload({
    occupation: "  Architect  ",
    company_works_at: "Studio North",
    date_of_birth: "1992-08-14",
    marital_status: "married",
    anniversary_date: "2020-02-20",
    address: "12 Residency Road",
    city: "Bengaluru",
    district: "Bengaluru Urban",
    state: "Karnataka",
    postal_code: "560025",
    country: "India",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.occupation, "Architect");
    assert.equal(result.data.marital_status, "married");
    assert.equal(result.data.is_married, true);
    assert.equal(result.data.city, "Bengaluru");
  }
});

test("contact profile clears blank optional values", () => {
  const result = validateContactProfilePayload({
    occupation: "   ",
    marital_status: null,
    city: "",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.occupation, null);
    assert.equal(result.data.marital_status, null);
    assert.equal(result.data.is_married, false);
    assert.equal(result.data.city, null);
  }
});

test("contact profile rejects identity fields and invalid personal data", () => {
  const identityResult = validateContactProfilePayload({
    first_name: "Changed outside lead workflow",
  });
  assert.equal(identityResult.ok, false);
  if (!identityResult.ok) {
    assert.deepEqual(identityResult.errors, [
      "Unknown profile field: first_name",
    ]);
  }

  const invalidResult = validateContactProfilePayload({
    marital_status: "complicated",
    date_of_birth: "2999-01-01",
  });
  assert.equal(invalidResult.ok, false);
  if (!invalidResult.ok) {
    assert.ok(
      invalidResult.errors.some((error) => error.includes("marital_status")),
    );
    assert.ok(
      invalidResult.errors.some((error) =>
        error.includes("date_of_birth cannot be in the future"),
      ),
    );
  }
});
