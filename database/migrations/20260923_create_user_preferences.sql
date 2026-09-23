BEGIN;

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  compact_mode BOOLEAN NOT NULL DEFAULT FALSE,
  email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  push_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  lead_assignment_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  task_reminders BOOLEAN NOT NULL DEFAULT TRUE,
  appointment_reminders BOOLEAN NOT NULL DEFAULT TRUE,
  digest_frequency VARCHAR(20) NOT NULL DEFAULT 'daily',
  default_landing_page VARCHAR(30) NOT NULL DEFAULT 'dashboard',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_preferences_digest_check
    CHECK (digest_frequency IN ('never', 'daily', 'weekly')),
  CONSTRAINT user_preferences_landing_check
    CHECK (default_landing_page IN ('dashboard', 'leads', 'activity', 'calendar'))
);

COMMIT;
