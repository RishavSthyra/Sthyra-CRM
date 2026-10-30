BEGIN;

-- A completed site visit precedes the customer's inventory shortlist in the
-- canonical opportunity journey. Keep the probability curve increasing as a
-- deal advances through those stages.
UPDATE project_opportunity_stages
SET position = CASE stage_key
      WHEN 'site_visit' THEN 2
      WHEN 'shortlisting' THEN 3
    END,
    probability = CASE stage_key
      WHEN 'site_visit' THEN 40
      WHEN 'shortlisting' THEN 55
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE stage_key IN ('site_visit', 'shortlisting');

-- Open opportunities carry a probability snapshot. Align it with the updated
-- project stage so pipeline and weighted values remain consistent.
UPDATE opportunities opportunity
SET probability = stage.probability,
    updated_at = CURRENT_TIMESTAMP
FROM project_opportunity_stages stage
WHERE opportunity.project_id = stage.project_id
  AND opportunity.stage_key = stage.stage_key
  AND opportunity.status = 'open'
  AND stage.is_active = TRUE
  AND stage.stage_key IN ('site_visit', 'shortlisting')
  AND opportunity.probability IS DISTINCT FROM stage.probability;

COMMIT;
