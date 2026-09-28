BEGIN;

ALTER TABLE inventory_reservations
  ADD COLUMN IF NOT EXISTS booking_reference VARCHAR(80),
  ADD COLUMN IF NOT EXISTS booking_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS booked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS booked_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_updated_by UUID REFERENCES users(user_id) ON DELETE SET NULL;

UPDATE inventory_reservations
SET booking_status = CASE status
  WHEN 'converted' THEN 'confirmed'
  WHEN 'cancelled' THEN 'cancelled'
  WHEN 'expired' THEN 'expired'
  ELSE 'pending'
END
WHERE booking_status = 'pending';

ALTER TABLE inventory_reservations
  DROP CONSTRAINT IF EXISTS inventory_reservations_booking_status_check,
  DROP CONSTRAINT IF EXISTS inventory_reservations_payment_status_check,
  DROP CONSTRAINT IF EXISTS inventory_reservations_paid_amount_check;

ALTER TABLE inventory_reservations
  ADD CONSTRAINT inventory_reservations_booking_status_check
    CHECK (booking_status IN ('pending','confirmed','cancelled','expired')),
  ADD CONSTRAINT inventory_reservations_payment_status_check
    CHECK (payment_status IN ('unpaid','partial','paid','refunded')),
  ADD CONSTRAINT inventory_reservations_paid_amount_check
    CHECK (amount_paid >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_reservations_booking_reference_uidx
  ON inventory_reservations (company_id, booking_reference)
  WHERE booking_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_reservations_opportunity_booking_idx
  ON inventory_reservations
    (opportunity_id, booking_status, payment_status, created_at DESC);

COMMIT;
