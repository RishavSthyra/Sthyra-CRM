BEGIN;

CREATE TABLE IF NOT EXISTS project_opportunity_stages (
  stage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  stage_key VARCHAR(100) NOT NULL,
  stage_name VARCHAR(100) NOT NULL,
  position INTEGER NOT NULL,
  probability INTEGER NOT NULL,
  color CHAR(7) NOT NULL DEFAULT '#87908b',
  is_initial BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT project_opportunity_stage_key_check
    CHECK (stage_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  CONSTRAINT project_opportunity_stage_name_check CHECK (BTRIM(stage_name) <> ''),
  CONSTRAINT project_opportunity_stage_position_check CHECK (position > 0),
  CONSTRAINT project_opportunity_stage_probability_check
    CHECK (probability BETWEEN 0 AND 100),
  CONSTRAINT project_opportunity_stage_color_check
    CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  UNIQUE (project_id, stage_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS project_opportunity_stages_initial_uidx
  ON project_opportunity_stages (project_id)
  WHERE is_active = TRUE AND is_initial = TRUE;

CREATE INDEX IF NOT EXISTS project_opportunity_stages_order_idx
  ON project_opportunity_stages (project_id, position)
  WHERE is_active = TRUE;

INSERT INTO project_opportunity_stages (
  project_id,
  stage_key,
  stage_name,
  position,
  probability,
  color,
  is_initial
)
SELECT
  project.project_id,
  stage.stage_key,
  stage.stage_name,
  stage.position,
  stage.probability,
  stage.color,
  stage.is_initial
FROM projects project
CROSS JOIN (
  VALUES
    ('discovery', 'Discovery', 1, 25, '#8b9cf6', TRUE),
    ('shortlisting', 'Shortlisting', 2, 40, '#a98af7', FALSE),
    ('site_visit', 'Site Visit', 3, 55, '#e7aa51', FALSE),
    ('proposal', 'Proposal', 4, 70, '#ef83ad', FALSE),
    ('negotiation', 'Negotiation', 5, 82, '#59cfaa', FALSE),
    ('booking', 'Booking', 6, 92, '#75d5bc', FALSE)
) AS stage(stage_key, stage_name, position, probability, color, is_initial)
ON CONFLICT (project_id, stage_key) DO UPDATE SET
  stage_name = EXCLUDED.stage_name,
  position = EXCLUDED.position,
  probability = EXCLUDED.probability,
  color = EXCLUDED.color,
  is_initial = EXCLUDED.is_initial,
  is_active = TRUE,
  updated_at = CURRENT_TIMESTAMP;

WITH moved AS (
  UPDATE opportunities
  SET stage_key = 'discovery',
      probability = 25,
      updated_at = CURRENT_TIMESTAMP
  WHERE stage_key = 'qualified'
  RETURNING opportunity_id, status
)
INSERT INTO opportunity_state_history (
  opportunity_id,
  action,
  from_status,
  to_status,
  from_stage_key,
  to_stage_key,
  metadata
)
SELECT
  opportunity_id,
  'lifecycle_aligned',
  status,
  status,
  'qualified',
  'discovery',
  '{"reason":"post-qualification work now belongs to the opportunity"}'::JSONB
FROM moved;

INSERT INTO project_opportunity_stages (
  project_id,
  stage_key,
  stage_name,
  position,
  probability,
  color,
  is_initial
)
SELECT DISTINCT
  opportunity.project_id,
  opportunity.stage_key,
  INITCAP(REPLACE(opportunity.stage_key, '_', ' ')),
  100 + ROW_NUMBER() OVER (
    PARTITION BY opportunity.project_id
    ORDER BY opportunity.stage_key
  ),
  opportunity.probability,
  '#87908b',
  FALSE
FROM opportunities opportunity
WHERE NOT EXISTS (
  SELECT 1
  FROM project_opportunity_stages stage
  WHERE stage.project_id = opportunity.project_id
    AND stage.stage_key = opportunity.stage_key
)
ON CONFLICT (project_id, stage_key) DO NOTHING;

-- Retire the previous active ordering before assigning the compact
-- pre-conversion pipeline. Existing rows remain available to history records.
UPDATE project_lead_stages
SET is_active = FALSE,
    is_initial = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE is_active = TRUE;

INSERT INTO project_lead_stages (
  project_id,
  stage_key,
  stage_name,
  position,
  is_initial,
  is_terminal
)
SELECT
  project.project_id,
  stage.stage_key,
  stage.stage_name,
  stage.position,
  stage.is_initial,
  FALSE
FROM projects project
CROSS JOIN (
  VALUES
    ('new', 'New', 1, TRUE),
    ('contact_attempted', 'Contact Attempted', 2, FALSE),
    ('contacted', 'Contacted', 3, FALSE),
    ('nurturing', 'Nurturing', 4, FALSE),
    ('qualified', 'Qualified / Converted', 5, FALSE)
) AS stage(stage_key, stage_name, position, is_initial)
ON CONFLICT (project_id, stage_key) DO UPDATE SET
  stage_name = EXCLUDED.stage_name,
  position = EXCLUDED.position,
  is_initial = EXCLUDED.is_initial,
  is_terminal = FALSE,
  is_active = TRUE,
  updated_at = CURRENT_TIMESTAMP;

UPDATE leads lead
SET stage_id = stage.stage_id,
    updated_at = CURRENT_TIMESTAMP
FROM project_lead_stages stage
WHERE lead.project_id = stage.project_id
  AND stage.stage_key = 'qualified'
  AND lead.status = 'qualified'
  AND lead.stage_id IS DISTINCT FROM stage.stage_id;

UPDATE leads lead
SET stage_id = contacted.stage_id,
    updated_at = CURRENT_TIMESTAMP
FROM project_lead_stages current_stage,
     project_lead_stages contacted
WHERE lead.stage_id = current_stage.stage_id
  AND lead.project_id = contacted.project_id
  AND contacted.stage_key = 'contacted'
  AND lead.status IN ('active', 'nurture')
  AND current_stage.stage_key IN (
    'site_visit_scheduled',
    'site_visit_completed',
    'negotiation',
    'booking_pending',
    'booked',
    'won',
    'lost'
  );

UPDATE project_lead_stages
SET is_active = FALSE,
    is_initial = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE stage_key IN (
  'site_visit_scheduled',
  'site_visit_completed',
  'negotiation',
  'booking_pending',
  'booked',
  'won',
  'lost'
);

CREATE OR REPLACE FUNCTION create_opportunity_for_qualified_lead()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'qualified'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'qualified') THEN
    INSERT INTO opportunities (
      company_id,
      project_id,
      lead_id,
      contact_id,
      opportunity_name,
      stage_key,
      amount,
      probability,
      current_owner_user_id,
      current_team_id,
      qualified_at
    )
    SELECT
      project.company_id,
      NEW.project_id,
      NEW.lead_id,
      NEW.contact_id,
      BTRIM(CONCAT_WS(' ', contact.first_name, contact.last_name)) ||
        ' · ' || project.project_name,
      COALESCE(initial_stage.stage_key, 'discovery'),
      NEW.budget,
      COALESCE(initial_stage.probability, 25),
      NEW.current_owner_user_id,
      NEW.current_team_id,
      COALESCE(NEW.qualified_at, CURRENT_TIMESTAMP)
    FROM projects project
    JOIN contacts contact ON contact.contact_id = NEW.contact_id
    LEFT JOIN project_opportunity_stages initial_stage
      ON initial_stage.project_id = NEW.project_id
     AND initial_stage.is_active = TRUE
     AND initial_stage.is_initial = TRUE
    WHERE project.project_id = NEW.project_id
    ON CONFLICT (lead_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
