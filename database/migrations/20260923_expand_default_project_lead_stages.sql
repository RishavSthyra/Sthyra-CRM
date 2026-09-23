BEGIN;

CREATE TEMP TABLE projects_using_default_lead_stages
ON COMMIT DROP AS
SELECT p.project_id
FROM projects p
WHERE NOT EXISTS (
  SELECT 1
  FROM project_lead_stages s
  WHERE s.project_id = p.project_id
    AND s.is_active = TRUE
    AND s.stage_key NOT IN ('new', 'contacted', 'qualified', 'closed')
);

UPDATE project_lead_stages s
SET is_active = FALSE,
    updated_at = CURRENT_TIMESTAMP
FROM projects_using_default_lead_stages p
WHERE s.project_id = p.project_id
  AND s.is_active = TRUE;

INSERT INTO project_lead_stages (
  project_id,
  stage_key,
  stage_name,
  position,
  is_initial,
  is_terminal,
  is_active
)
SELECT
  p.project_id,
  stage.stage_key,
  stage.stage_name,
  stage.position,
  stage.is_initial,
  stage.is_terminal,
  TRUE
FROM projects_using_default_lead_stages p
CROSS JOIN (
  VALUES
    ('new', 'New', 1, TRUE, FALSE),
    ('contacted', 'Contacted', 2, FALSE, FALSE),
    ('qualified', 'Qualified', 3, FALSE, FALSE),
    ('site_visit_scheduled', 'Site Visit Scheduled', 4, FALSE, FALSE),
    ('site_visit_completed', 'Site Visit Completed', 5, FALSE, FALSE),
    ('negotiation', 'Negotiation', 6, FALSE, FALSE),
    ('booking_pending', 'Booking Pending', 7, FALSE, FALSE),
    ('booked', 'Booked', 8, FALSE, FALSE),
    ('won', 'Won', 9, FALSE, TRUE),
    ('lost', 'Lost', 10, FALSE, TRUE)
) AS stage(stage_key, stage_name, position, is_initial, is_terminal)
ON CONFLICT (project_id, stage_key) DO UPDATE
SET stage_name = EXCLUDED.stage_name,
    position = EXCLUDED.position,
    is_initial = EXCLUDED.is_initial,
    is_terminal = EXCLUDED.is_terminal,
    is_active = TRUE,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;
