CREATE TABLE IF NOT EXISTS lead_sources (
  source_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name VARCHAR(150) NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT lead_sources_name_not_blank CHECK (BTRIM(source_name) <> ''),
  CONSTRAINT lead_sources_type_not_blank CHECK (BTRIM(source_type) <> ''),
  CONSTRAINT lead_sources_code_not_blank CHECK (BTRIM(code) <> '')
);

CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES lead_sources(source_id) ON DELETE SET NULL,
  campaign_name VARCHAR(200) NOT NULL,
  campaign_code VARCHAR(50) NOT NULL UNIQUE,
  campaign_type VARCHAR(50),
  start_date DATE,
  end_date DATE,
  budget NUMERIC(14,2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT campaigns_name_not_blank CHECK (BTRIM(campaign_name) <> ''),
  CONSTRAINT campaigns_code_not_blank CHECK (BTRIM(campaign_code) <> ''),
  CONSTRAINT campaigns_date_check
    CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  CONSTRAINT campaigns_budget_check CHECK (budget IS NULL OR budget >= 0)
);

CREATE INDEX IF NOT EXISTS campaigns_source_idx ON campaigns (source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tags (
  tag_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_name VARCHAR(100) NOT NULL,
  description TEXT,
  color VARCHAR(20),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS tags_active_name_unique_idx
  ON tags (LOWER(tag_name)) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS project_lead_configurations (
  project_id INTEGER PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
  default_source_id UUID REFERENCES lead_sources(source_id) ON DELETE SET NULL,
  default_campaign_id UUID REFERENCES campaigns(campaign_id) ON DELETE SET NULL,
  auto_assignment_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  assignment_strategy VARCHAR(30) NOT NULL DEFAULT 'manual',
  duplicate_check_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  duplicate_window_days INTEGER NOT NULL DEFAULT 90,
  response_sla_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT project_lead_assignment_strategy_check
    CHECK (assignment_strategy IN ('manual', 'round_robin', 'load_balanced')),
  CONSTRAINT project_lead_duplicate_window_check
    CHECK (duplicate_window_days BETWEEN 1 AND 3650),
  CONSTRAINT project_lead_sla_check
    CHECK (response_sla_minutes BETWEEN 1 AND 43200)
);

CREATE TABLE IF NOT EXISTS project_lead_stages (
  stage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  stage_key VARCHAR(50) NOT NULL,
  stage_name VARCHAR(100) NOT NULL,
  position INTEGER NOT NULL,
  is_initial BOOLEAN NOT NULL DEFAULT FALSE,
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT project_lead_stage_position_check CHECK (position > 0),
  CONSTRAINT project_lead_stage_key_not_blank CHECK (BTRIM(stage_key) <> ''),
  CONSTRAINT project_lead_stage_name_not_blank CHECK (BTRIM(stage_name) <> ''),
  CONSTRAINT project_lead_stage_unique_key UNIQUE (project_id, stage_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS project_lead_one_initial_stage_idx
  ON project_lead_stages (project_id) WHERE is_active AND is_initial;
CREATE UNIQUE INDEX IF NOT EXISTS project_lead_active_stage_position_idx
  ON project_lead_stages (project_id, position) WHERE is_active;

CREATE TABLE IF NOT EXISTS project_qualification_fields (
  field_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  field_key VARCHAR(50) NOT NULL,
  field_label VARCHAR(100) NOT NULL,
  field_type VARCHAR(30) NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  position INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT project_qualification_field_type_check
    CHECK (field_type IN ('text', 'number', 'boolean', 'date', 'single_select', 'multi_select')),
  CONSTRAINT project_qualification_options_array CHECK (jsonb_typeof(options) = 'array'),
  CONSTRAINT project_qualification_position_check CHECK (position > 0),
  CONSTRAINT project_qualification_unique_key UNIQUE (project_id, field_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS project_qualification_active_position_idx
  ON project_qualification_fields (project_id, position) WHERE is_active;

CREATE TABLE IF NOT EXISTS project_closing_reasons (
  reason_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  reason_key VARCHAR(50) NOT NULL,
  reason_name VARCHAR(100) NOT NULL,
  outcome VARCHAR(20) NOT NULL,
  position INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT project_closing_reason_outcome_check
    CHECK (outcome IN ('won', 'lost', 'disqualified')),
  CONSTRAINT project_closing_reason_position_check CHECK (position > 0),
  CONSTRAINT project_closing_reason_unique_key UNIQUE (project_id, reason_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS project_closing_reason_active_position_idx
  ON project_closing_reasons (project_id, position) WHERE is_active;
