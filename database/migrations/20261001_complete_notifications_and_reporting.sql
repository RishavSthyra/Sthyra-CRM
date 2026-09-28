BEGIN;

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS site_visit_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS quotation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS booking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS follow_up_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS category VARCHAR(40) NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS event_key VARCHAR(220);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check CHECK (
  category IN (
    'assignment',
    'appointment',
    'site_visit',
    'quotation',
    'booking',
    'transfer',
    'follow_up',
    'opportunity',
    'telephony',
    'system'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_event_uidx
  ON notifications (user_id, event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_user_category_time_idx
  ON notifications (user_id, category, created_at DESC);

CREATE INDEX IF NOT EXISTS opportunity_reporting_idx
  ON opportunities (company_id, project_id, status, expected_close_date, closed_at);

CREATE INDEX IF NOT EXISTS inventory_unit_status_history_reporting_idx
  ON inventory_unit_status_history (created_at, to_status, unit_id);

COMMIT;
