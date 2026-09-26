BEGIN;

CREATE TABLE IF NOT EXISTS calls (
  call_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(lead_id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(contact_id) ON DELETE SET NULL,
  direction VARCHAR(20) NOT NULL DEFAULT 'outbound',
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  outcome VARCHAR(30),
  phone_number VARCHAR(30) NOT NULL,
  subject VARCHAR(250) NOT NULL,
  summary TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  owner_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT calls_direction_check CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT calls_status_check
    CHECK (status IN ('scheduled', 'ringing', 'answered', 'missed', 'completed', 'failed', 'cancelled')),
  CONSTRAINT calls_outcome_check
    CHECK (outcome IS NULL OR outcome IN ('interested', 'follow_up', 'no_answer', 'not_interested', 'wrong_number', 'voicemail')),
  CONSTRAINT calls_phone_not_blank CHECK (BTRIM(phone_number) <> ''),
  CONSTRAINT calls_subject_not_blank CHECK (BTRIM(subject) <> ''),
  CONSTRAINT calls_duration_check CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  CONSTRAINT calls_time_check CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS calls_project_time_idx
  ON calls (project_id, started_at DESC, call_id DESC);
CREATE INDEX IF NOT EXISTS calls_lead_time_idx
  ON calls (lead_id, started_at DESC) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calls_owner_time_idx
  ON calls (owner_user_id, started_at DESC) WHERE owner_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS emails (
  email_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(lead_id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(contact_id) ON DELETE SET NULL,
  direction VARCHAR(20) NOT NULL DEFAULT 'outbound',
  status VARCHAR(20) NOT NULL DEFAULT 'sent',
  subject VARCHAR(250) NOT NULL,
  body TEXT NOT NULL,
  from_address VARCHAR(255) NOT NULL,
  to_addresses TEXT[] NOT NULL,
  cc_addresses TEXT[] NOT NULL DEFAULT '{}',
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  owner_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT emails_direction_check CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT emails_status_check
    CHECK (status IN ('draft', 'queued', 'sent', 'delivered', 'opened', 'replied', 'bounced', 'failed')),
  CONSTRAINT emails_subject_not_blank CHECK (BTRIM(subject) <> ''),
  CONSTRAINT emails_body_not_blank CHECK (BTRIM(body) <> ''),
  CONSTRAINT emails_from_not_blank CHECK (BTRIM(from_address) <> ''),
  CONSTRAINT emails_recipient_check CHECK (CARDINALITY(to_addresses) > 0)
);

CREATE INDEX IF NOT EXISTS emails_project_time_idx
  ON emails (project_id, COALESCE(sent_at, received_at, created_at) DESC, email_id DESC);
CREATE INDEX IF NOT EXISTS emails_lead_time_idx
  ON emails (lead_id, COALESCE(sent_at, received_at, created_at) DESC)
  WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS emails_owner_time_idx
  ON emails (owner_user_id, COALESCE(sent_at, received_at, created_at) DESC)
  WHERE owner_user_id IS NOT NULL;

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_source_type_check;
ALTER TABLE activities
  ADD CONSTRAINT activities_source_type_check
  CHECK (source_type IN ('task', 'note', 'appointment', 'call', 'email'));

COMMIT;
