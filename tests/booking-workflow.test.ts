import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKING_WORKFLOW_ERRORS,
  canConfirmBooking,
  canStartBookingWorkflow,
} from "../lib/bookingWorkflow";

test("booking workflow starts only for an accepted quotation on an open deal", () => {
  assert.equal(canStartBookingWorkflow("draft", "open"), false);
  assert.equal(canStartBookingWorkflow("sent", "open"), false);
  assert.equal(canStartBookingWorkflow("accepted", "closed"), false);
  assert.equal(canStartBookingWorkflow("accepted", "open"), true);
});

test("booking confirmation requires an accepted quotation and submitted form", () => {
  assert.equal(canConfirmBooking("sent", "submitted"), false);
  assert.equal(canConfirmBooking("accepted", "active"), false);
  assert.equal(canConfirmBooking("accepted", "confirmed"), false);
  assert.equal(canConfirmBooking("accepted", "submitted"), true);
});

test("direct reservation conversion explains the canonical booking path", () => {
  assert.match(
    BOOKING_WORKFLOW_ERRORS.directConfirmationDisabled,
    /accepted quotation/i,
  );
  assert.match(
    BOOKING_WORKFLOW_ERRORS.directConfirmationDisabled,
    /booking form/i,
  );
});
