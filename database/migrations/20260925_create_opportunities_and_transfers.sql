BEGIN;

CREATE TABLE IF NOT EXISTS opportunities (
  opportunity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  lead_id UUID NOT NULL UNIQUE REFERENCES leads(lead_id) ON DELETE RESTRICT,
  contact_id UUID NOT NULL REFERENCES contacts(contact_id) ON DELETE RESTRICT,
  opportunity_name VARCHAR(250) NOT NULL,
  description TEXT,
  stage_key VARCHAR(100) NOT NULL DEFAULT 'qualified',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  amount NUMERIC(14,2),
  probability INTEGER NOT NULL DEFAULT 25,
  expected_close_date DATE,
  current_owner_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  current_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  outcome VARCHAR(20),
  closing_reason TEXT,
  closing_notes TEXT,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  closed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  qualified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT opportunities_name_not_blank CHECK (BTRIM(opportunity_name) <> ''),
  CONSTRAINT opportunities_stage_key_check
    CHECK (stage_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  CONSTRAINT opportunities_status_check CHECK (status IN ('open', 'closed')),
  CONSTRAINT opportunities_outcome_check
    CHECK (outcome IS NULL OR outcome IN ('won', 'lost')),
  CONSTRAINT opportunities_amount_check CHECK (amount IS NULL OR amount >= 0),
  CONSTRAINT opportunities_probability_check CHECK (probability BETWEEN 0 AND 100),
  CONSTRAINT opportunities_close_state_check CHECK (
    (status = 'open' AND outcome IS NULL AND closed_at IS NULL)
    OR (status = 'closed' AND outcome IS NOT NULL AND closed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS opportunities_project_status_idx
  ON opportunities (project_id, status, stage_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS opportunities_owner_status_idx
  ON opportunities (current_owner_user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS opportunities_contact_idx
  ON opportunities (contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS opportunity_state_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  action VARCHAR(40) NOT NULL,
  from_status VARCHAR(20),
  to_status VARCHAR(20) NOT NULL,
  from_stage_key VARCHAR(100),
  to_stage_key VARCHAR(100) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  performed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT opportunity_state_history_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS opportunity_state_history_time_idx
  ON opportunity_state_history (opportunity_id, created_at DESC, history_id DESC);

CREATE TABLE IF NOT EXISTS opportunity_ownership_history (
  ownership_history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  change_type VARCHAR(20) NOT NULL,
  from_owner_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  to_owner_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  from_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  to_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  performed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT opportunity_ownership_change_type_check
    CHECK (change_type IN ('assigned', 'transferred', 'unassigned')),
  CONSTRAINT opportunity_ownership_changed_check CHECK (
    from_owner_user_id IS DISTINCT FROM to_owner_user_id
    OR from_team_id IS DISTINCT FROM to_team_id
  )
);

CREATE INDEX IF NOT EXISTS opportunity_ownership_history_time_idx
  ON opportunity_ownership_history
  (opportunity_id, created_at DESC, ownership_history_id DESC);

CREATE TABLE IF NOT EXISTS opportunity_shortlists (
  shortlist_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  title VARCHAR(250) NOT NULL,
  notes TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT opportunity_shortlist_title_not_blank CHECK (BTRIM(title) <> ''),
  CONSTRAINT opportunity_shortlist_items_array CHECK (jsonb_typeof(items) = 'array'),
  CONSTRAINT opportunity_shortlist_status_check
    CHECK (status IN ('active', 'selected', 'archived'))
);

CREATE INDEX IF NOT EXISTS opportunity_shortlists_time_idx
  ON opportunity_shortlists (opportunity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS opportunity_quotations (
  quotation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  quotation_number VARCHAR(100) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  valid_until DATE,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT opportunity_quotation_number_not_blank CHECK (BTRIM(quotation_number) <> ''),
  CONSTRAINT opportunity_quotation_version_check CHECK (version > 0),
  CONSTRAINT opportunity_quotation_status_check
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled')),
  CONSTRAINT opportunity_quotation_amount_check
    CHECK (subtotal >= 0 AND tax_amount >= 0 AND total_amount >= 0),
  CONSTRAINT opportunity_quotation_line_items_array
    CHECK (jsonb_typeof(line_items) = 'array'),
  UNIQUE (opportunity_id, quotation_number, version)
);

CREATE INDEX IF NOT EXISTS opportunity_quotations_time_idx
  ON opportunity_quotations (opportunity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transfer_checklist_templates (
  template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(project_id) ON DELETE CASCADE,
  template_name VARCHAR(150) NOT NULL,
  description TEXT,
  applies_to VARCHAR(20) NOT NULL DEFAULT 'both',
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transfer_template_name_not_blank CHECK (BTRIM(template_name) <> ''),
  CONSTRAINT transfer_template_applies_to_check
    CHECK (applies_to IN ('lead', 'opportunity', 'both'))
);

CREATE UNIQUE INDEX IF NOT EXISTS transfer_template_name_unique_idx
  ON transfer_checklist_templates
  (company_id, COALESCE(project_id, 0), LOWER(template_name));

CREATE TABLE IF NOT EXISTS transfer_checklist_template_items (
  item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES transfer_checklist_templates(template_id) ON DELETE CASCADE,
  label VARCHAR(250) NOT NULL,
  description TEXT,
  position INTEGER NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transfer_template_item_label_not_blank CHECK (BTRIM(label) <> ''),
  CONSTRAINT transfer_template_item_position_check CHECK (position > 0),
  UNIQUE (template_id, position)
);

CREATE TABLE IF NOT EXISTS transfers (
  transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  subject_type VARCHAR(20) NOT NULL,
  lead_id UUID REFERENCES leads(lead_id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  from_owner_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  from_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  to_owner_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  to_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  checklist_template_id UUID REFERENCES transfer_checklist_templates(template_id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  reason TEXT,
  notes TEXT,
  rejection_reason TEXT,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  validated_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  decided_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  validated_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  force_assigned_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transfers_subject_type_check
    CHECK (subject_type IN ('lead', 'opportunity')),
  CONSTRAINT transfers_subject_check CHECK (
    (subject_type = 'lead' AND lead_id IS NOT NULL AND opportunity_id IS NULL)
    OR (subject_type = 'opportunity' AND opportunity_id IS NOT NULL AND lead_id IS NULL)
  ),
  CONSTRAINT transfers_target_check
    CHECK ((to_owner_user_id IS NOT NULL)::integer + (to_team_id IS NOT NULL)::integer = 1),
  CONSTRAINT transfers_status_check CHECK (
    status IN ('draft', 'validated', 'submitted', 'accepted', 'rejected',
               'cancelled', 'expired', 'force_assigned')
  ),
  CONSTRAINT transfers_validation_errors_array
    CHECK (jsonb_typeof(validation_errors) = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS transfers_one_active_subject_idx
  ON transfers (subject_type, COALESCE(lead_id, opportunity_id))
  WHERE status IN ('draft', 'validated', 'submitted');
CREATE INDEX IF NOT EXISTS transfers_project_status_idx
  ON transfers (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS transfers_recipient_status_idx
  ON transfers (to_owner_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS transfer_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES transfers(transfer_id) ON DELETE CASCADE,
  action VARCHAR(30) NOT NULL,
  from_status VARCHAR(20),
  to_status VARCHAR(20) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  performed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transfer_history_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS transfer_history_time_idx
  ON transfer_history (transfer_id, created_at DESC, history_id DESC);

CREATE TABLE IF NOT EXISTS transfer_checklist_items (
  item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES transfers(transfer_id) ON DELETE CASCADE,
  template_item_id UUID REFERENCES transfer_checklist_template_items(item_id) ON DELETE SET NULL,
  label VARCHAR(250) NOT NULL,
  description TEXT,
  position INTEGER NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  completed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transfer_checklist_item_label_not_blank CHECK (BTRIM(label) <> ''),
  CONSTRAINT transfer_checklist_item_position_check CHECK (position > 0),
  UNIQUE (transfer_id, position)
);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(opportunity_id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS appointments_opportunity_time_idx
  ON appointments (opportunity_id, starts_at DESC)
  WHERE opportunity_id IS NOT NULL;

INSERT INTO opportunities (
  company_id, project_id, lead_id, contact_id, opportunity_name, stage_key,
  amount, current_owner_user_id, current_team_id, qualified_at
)
SELECT
  p.company_id,
  l.project_id,
  l.lead_id,
  l.contact_id,
  BTRIM(CONCAT_WS(' ', c.first_name, c.last_name)) || ' · ' || p.project_name,
  'qualified',
  l.budget,
  l.current_owner_user_id,
  l.current_team_id,
  COALESCE(l.qualified_at, l.updated_at, CURRENT_TIMESTAMP)
FROM leads l
JOIN projects p ON p.project_id=l.project_id
JOIN contacts c ON c.contact_id=l.contact_id
WHERE l.status='qualified'
ON CONFLICT (lead_id) DO NOTHING;

INSERT INTO opportunity_state_history (
  opportunity_id, action, from_status, to_status, from_stage_key,
  to_stage_key, metadata, created_at
)
SELECT o.opportunity_id, 'qualified_from_lead', NULL, o.status, NULL,
       o.stage_key, JSONB_BUILD_OBJECT('lead_id', o.lead_id), o.qualified_at
FROM opportunities o
WHERE NOT EXISTS (
  SELECT 1 FROM opportunity_state_history h
  WHERE h.opportunity_id=o.opportunity_id
);

CREATE OR REPLACE FUNCTION create_opportunity_for_qualified_lead()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'qualified' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'qualified') THEN
    INSERT INTO opportunities (
      company_id, project_id, lead_id, contact_id, opportunity_name, stage_key,
      amount, current_owner_user_id, current_team_id, qualified_at
    )
    SELECT p.company_id, NEW.project_id, NEW.lead_id, NEW.contact_id,
           BTRIM(CONCAT_WS(' ', c.first_name, c.last_name)) || ' · ' || p.project_name,
           'qualified', NEW.budget, NEW.current_owner_user_id,
           NEW.current_team_id, COALESCE(NEW.qualified_at, CURRENT_TIMESTAMP)
    FROM projects p
    JOIN contacts c ON c.contact_id=NEW.contact_id
    WHERE p.project_id=NEW.project_id
    ON CONFLICT (lead_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_create_opportunity_after_qualification ON leads;
CREATE TRIGGER leads_create_opportunity_after_qualification
AFTER INSERT OR UPDATE OF status ON leads
FOR EACH ROW EXECUTE FUNCTION create_opportunity_for_qualified_lead();

COMMIT;
