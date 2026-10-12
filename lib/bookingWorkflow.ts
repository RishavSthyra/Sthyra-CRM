export const BOOKING_WORKFLOW_ERRORS = {
  quotationRequired:
    "An accepted quotation is required before the booking workflow can begin",
  formRequired:
    "The customer must submit the booking form before the booking can be confirmed",
  directConfirmationDisabled:
    "Bookings can only be confirmed from the accepted quotation after the customer submits the booking form",
} as const;

export function canStartBookingWorkflow(
  quotationStatus: unknown,
  opportunityStatus: unknown,
) {
  return quotationStatus === "accepted" && opportunityStatus === "open";
}

export function canConfirmBooking(
  quotationStatus: unknown,
  bookingFormStatus: unknown,
) {
  return quotationStatus === "accepted" && bookingFormStatus === "submitted";
}
