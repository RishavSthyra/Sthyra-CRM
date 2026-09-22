CREATE TABLE IF NOT EXISTS lead_intake_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(200) NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'received',
  lead_id UUID,
  error_code VARCHAR(100),
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempt_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_action VARCHAR(20),
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT lead_intake_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT lead_intake_status_check
    CHECK (status IN ('received', 'processed', 'quarantined', 'failed', 'discarded')),
  CONSTRAINT lead_intake_resolution_check
    CHECK (resolution_action IS NULL OR resolution_action IN ('replay', 'discard')),
  CONSTRAINT lead_intake_attempt_check CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS lead_intake_status_time_idx
  ON lead_intake_events (status, received_at DESC, event_id DESC);

CREATE TABLE IF NOT EXISTS leads (
  lead_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(contact_id) ON DELETE RESTRICT,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  source_id UUID REFERENCES lead_sources(source_id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(campaign_id) ON DELETE SET NULL,
  intake_event_id UUID UNIQUE REFERENCES lead_intake_events(event_id) ON DELETE SET NULL,
  stage_id UUID REFERENCES project_lead_stages(stage_id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  sub_source VARCHAR(150),
  temperature VARCHAR(20),
  customer_type VARCHAR(50),
  current_owner_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  current_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  preferred_location VARCHAR(200),
  preferred_config VARCHAR(100),
  preferred_facing VARCHAR(100),
  preferred_floor VARCHAR(100),
  preferred_view VARCHAR(100),
  budget NUMERIC(14,2),
  buying_reason TEXT,
  qualification_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  closing_reason_id UUID REFERENCES project_closing_reasons(reason_id) ON DELETE SET NULL,
  closing_notes TEXT,
  duplicate_of_lead_id UUID REFERENCES leads(lead_id) ON DELETE SET NULL,
  invalid_reason TEXT,
  nurture_reason TEXT,
  nurture_until TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_at TIMESTAMPTZ,
  qualified_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT leads_status_check
    CHECK (status IN ('active', 'qualified', 'closed', 'nurture', 'duplicate', 'invalid')),
  CONSTRAINT leads_temperature_check
    CHECK (temperature IS NULL OR temperature IN ('cold', 'warm', 'hot')),
  CONSTRAINT leads_budget_check CHECK (budget IS NULL OR budget >= 0),
  CONSTRAINT leads_qualification_object CHECK (jsonb_typeof(qualification_data) = 'object'),
  CONSTRAINT leads_not_duplicate_of_self CHECK (duplicate_of_lead_id IS NULL OR duplicate_of_lead_id <> lead_id)
);

ALTER TABLE lead_intake_events
  DROP CONSTRAINT IF EXISTS lead_intake_events_lead_id_fkey;
ALTER TABLE lead_intake_events
  ADD CONSTRAINT lead_intake_events_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS leads_project_status_idx
  ON leads (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_owner_status_idx
  ON leads (current_owner_user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS leads_team_status_idx
  ON leads (current_team_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS leads_contact_idx ON leads (contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lead_tags (
  lead_id UUID NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(tag_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (lead_id, tag_id)
);

CREATE TABLE IF NOT EXISTS lead_state_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  command VARCHAR(50) NOT NULL,
  from_status VARCHAR(20),
  to_status VARCHAR(20) NOT NULL,
  from_stage_id UUID REFERENCES project_lead_stages(stage_id) ON DELETE SET NULL,
  to_stage_id UUID REFERENCES project_lead_stages(stage_id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  performed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT lead_state_history_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS lead_state_history_lead_time_idx
  ON lead_state_history (lead_id, created_at DESC, history_id DESC);

CREATE TABLE IF NOT EXISTS lead_attributions (
  attribution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  source_id UUID REFERENCES lead_sources(source_id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(campaign_id) ON DELETE SET NULL,
  attribution_type VARCHAR(20) NOT NULL,
  sub_source VARCHAR(150),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT lead_attributions_type_check
    CHECK (attribution_type IN ('first_touch', 'last_touch', 'assist', 'manual')),
  CONSTRAINT lead_attributions_reference_check
    CHECK (source_id IS NOT NULL OR campaign_id IS NOT NULL OR sub_source IS NOT NULL),
  CONSTRAINT lead_attributions_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS lead_attributions_lead_time_idx
  ON lead_attributions (lead_id, occurred_at DESC, attribution_id DESC);

CREATE TABLE IF NOT EXISTS lead_ownership_history (
  ownership_history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  change_type VARCHAR(20) NOT NULL,
  from_owner_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  to_owner_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  from_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  to_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  performed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT lead_ownership_change_type_check
    CHECK (change_type IN ('assigned', 'transferred', 'unassigned')),
  CONSTRAINT lead_ownership_changed_check
    CHECK (
      from_owner_user_id IS DISTINCT FROM to_owner_user_id
      OR from_team_id IS DISTINCT FROM to_team_id
    )
);

CREATE INDEX IF NOT EXISTS lead_ownership_history_lead_time_idx
  ON lead_ownership_history (lead_id, created_at DESC, ownership_history_id DESC);

CREATE TABLE IF NOT EXISTS lead_tag_history (
  tag_history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(tag_id) ON DELETE SET NULL,
  action VARCHAR(10) NOT NULL,
  performed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT lead_tag_history_action_check CHECK (action IN ('added', 'removed'))
);

CREATE INDEX IF NOT EXISTS lead_tag_history_lead_time_idx
  ON lead_tag_history (lead_id, created_at DESC, tag_history_id DESC);

CREATE TABLE IF NOT EXISTS lead_next_actions (
  lead_id UUID PRIMARY KEY REFERENCES leads(lead_id) ON DELETE CASCADE,
  action_type VARCHAR(50) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT lead_next_actions_status_check
    CHECK (status IN ('pending', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS lead_next_actions_due_idx
  ON lead_next_actions (status, due_at, lead_id);

CREATE TABLE IF NOT EXISTS lead_next_action_history (
  next_action_history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  previous_action JSONB,
  next_action JSONB NOT NULL,
  performed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT lead_next_action_previous_object
    CHECK (previous_action IS NULL OR jsonb_typeof(previous_action) = 'object'),
  CONSTRAINT lead_next_action_next_object
    CHECK (jsonb_typeof(next_action) = 'object')
);

CREATE INDEX IF NOT EXISTS lead_next_action_history_lead_time_idx
  ON lead_next_action_history (lead_id, created_at DESC, next_action_history_id DESC);
