BEGIN;

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  lead_assignment_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  task_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  appointment_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  opportunity_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  transfer_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  telephony_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  digest_frequency VARCHAR(20) NOT NULL DEFAULT 'instant',
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notification_preferences_digest_check
    CHECK (digest_frequency IN ('instant', 'daily', 'weekly', 'never')),
  CONSTRAINT notification_preferences_quiet_hours_check
    CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL))
);

CREATE TABLE IF NOT EXISTS notification_templates (
  template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(project_id) ON DELETE CASCADE,
  template_key VARCHAR(100) NOT NULL,
  template_name VARCHAR(180) NOT NULL,
  description TEXT,
  channels TEXT[] NOT NULL DEFAULT ARRAY['in_app']::TEXT[],
  subject_template VARCHAR(300),
  body_template TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  action_url_template VARCHAR(2000),
  variables JSONB NOT NULL DEFAULT '[]'::JSONB,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notification_templates_key_not_blank CHECK (BTRIM(template_key) <> ''),
  CONSTRAINT notification_templates_name_not_blank CHECK (BTRIM(template_name) <> ''),
  CONSTRAINT notification_templates_body_not_blank CHECK (BTRIM(body_template) <> ''),
  CONSTRAINT notification_templates_severity_check
    CHECK (severity IN ('info', 'success', 'warning', 'error')),
  CONSTRAINT notification_templates_channels_check
    CHECK (channels <@ ARRAY['in_app', 'email', 'push']::TEXT[] AND CARDINALITY(channels) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_templates_scope_key_uidx
  ON notification_templates (company_id, COALESCE(project_id, 0), template_key);
CREATE INDEX IF NOT EXISTS notification_templates_company_idx
  ON notification_templates (company_id, is_active, template_key);

CREATE TABLE IF NOT EXISTS notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(project_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  template_id UUID REFERENCES notification_templates(template_id) ON DELETE SET NULL,
  notification_type VARCHAR(100) NOT NULL,
  title VARCHAR(300) NOT NULL,
  body TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  entity_type VARCHAR(80),
  entity_id UUID,
  action_url VARCHAR(2000),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notifications_type_not_blank CHECK (BTRIM(notification_type) <> ''),
  CONSTRAINT notifications_title_not_blank CHECK (BTRIM(title) <> ''),
  CONSTRAINT notifications_body_not_blank CHECK (BTRIM(body) <> ''),
  CONSTRAINT notifications_severity_check
    CHECK (severity IN ('info', 'success', 'warning', 'error')),
  CONSTRAINT notifications_read_check
    CHECK ((is_read = TRUE AND read_at IS NOT NULL) OR (is_read = FALSE AND read_at IS NULL))
);

CREATE INDEX IF NOT EXISTS notifications_user_time_idx
  ON notifications (user_id, created_at DESC, notification_id DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id, created_at DESC) WHERE is_read = FALSE;

CREATE TABLE IF NOT EXISTS notification_deliveries (
  delivery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES notifications(notification_id) ON DELETE CASCADE,
  template_id UUID REFERENCES notification_templates(template_id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL,
  recipient VARCHAR(500),
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  provider_message_id VARCHAR(255),
  error_message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  next_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notification_deliveries_channel_check CHECK (channel IN ('in_app', 'email', 'push')),
  CONSTRAINT notification_deliveries_status_check
    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  CONSTRAINT notification_deliveries_attempts_check
    CHECK (attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts)
);

CREATE INDEX IF NOT EXISTS notification_deliveries_retry_idx
  ON notification_deliveries (status, next_attempt_at, created_at)
  WHERE status IN ('queued', 'failed');

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS provider VARCHAR(50) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS provider_call_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS provider_parent_call_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS provider_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS initiated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS on_hold BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recording_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS recording_url TEXT,
  ADD COLUMN IF NOT EXISTS recording_status VARCHAR(20) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(user_id) ON DELETE SET NULL;

ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_status_check;
ALTER TABLE calls ADD CONSTRAINT calls_status_check CHECK (
  status IN ('scheduled', 'initiating', 'queued', 'ringing', 'answered', 'in_progress',
             'on_hold', 'missed', 'completed', 'failed', 'busy', 'no_answer', 'cancelled')
);
ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_outcome_check;
ALTER TABLE calls ADD CONSTRAINT calls_outcome_check CHECK (
  outcome IS NULL OR outcome IN ('interested', 'follow_up', 'no_answer', 'not_interested',
    'wrong_number', 'voicemail', 'connected', 'callback_requested', 'qualified', 'do_not_call')
);
ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_recording_status_check;
ALTER TABLE calls ADD CONSTRAINT calls_recording_status_check CHECK (
  recording_status IN ('none', 'processing', 'available', 'failed')
);
CREATE UNIQUE INDEX IF NOT EXISTS calls_provider_id_uidx
  ON calls (company_id, provider, provider_call_id) WHERE provider_call_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS call_state_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(call_id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  from_status VARCHAR(20),
  to_status VARCHAR(20),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  actor_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS call_state_history_call_idx
  ON call_state_history (call_id, created_at DESC);

CREATE TABLE IF NOT EXISTS call_transfers (
  transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(call_id) ON DELETE CASCADE,
  from_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  to_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  to_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  to_phone_number VARCHAR(30),
  status VARCHAR(20) NOT NULL DEFAULT 'requested',
  provider_transfer_id VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  requested_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  CONSTRAINT call_transfers_target_check CHECK (
    ((to_user_id IS NOT NULL)::INTEGER + (to_team_id IS NOT NULL)::INTEGER +
     (to_phone_number IS NOT NULL)::INTEGER) = 1
  ),
  CONSTRAINT call_transfers_status_check CHECK (status IN ('requested', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS telephony_events (
  telephony_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(50) NOT NULL,
  provider_event_id VARCHAR(255) NOT NULL,
  provider_call_id VARCHAR(255),
  call_id UUID REFERENCES calls(call_id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS telephony_agent_presence (
  user_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(project_id) ON DELETE SET NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'generic',
  provider_agent_id VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'offline',
  current_call_id UUID REFERENCES calls(call_id) ON DELETE SET NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT telephony_agent_presence_status_check
    CHECK (status IN ('offline', 'available', 'busy', 'on_call', 'away'))
);
CREATE INDEX IF NOT EXISTS telephony_agent_presence_company_idx
  ON telephony_agent_presence (company_id, project_id, status);

CREATE TABLE IF NOT EXISTS telephony_phone_numbers (
  phone_number_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(project_id) ON DELETE CASCADE,
  phone_number VARCHAR(30) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'generic',
  route_to_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  route_to_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, phone_number),
  CONSTRAINT telephony_phone_numbers_route_check CHECK (
    NOT (route_to_user_id IS NOT NULL AND route_to_team_id IS NOT NULL)
  )
);

COMMIT;
