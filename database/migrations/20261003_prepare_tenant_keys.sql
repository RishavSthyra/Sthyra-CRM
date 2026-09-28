-- Run this migration on the current PostgreSQL database before creating the
-- dump that will be restored into Supabase. Supabase-specific Auth links and
-- RLS policies are added by 20261003_supabase_multitenancy_foundation.sql.

BEGIN;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE lead_sources ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE lead_intake_events ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS company_id INTEGER;

UPDATE leads AS lead
SET company_id = project.company_id
FROM projects AS project
WHERE project.project_id = lead.project_id
  AND lead.company_id IS NULL;

WITH contact_company AS (
  SELECT lead.contact_id, MIN(lead.company_id) AS company_id
  FROM leads AS lead
  WHERE lead.company_id IS NOT NULL
  GROUP BY lead.contact_id
  HAVING COUNT(DISTINCT lead.company_id) = 1
)
UPDATE contacts AS contact
SET company_id = candidate.company_id
FROM contact_company AS candidate
WHERE candidate.contact_id = contact.contact_id
  AND contact.company_id IS NULL;

WITH account_company AS (
  SELECT contact.account_id, MIN(contact.company_id) AS company_id
  FROM contacts AS contact
  WHERE contact.account_id IS NOT NULL AND contact.company_id IS NOT NULL
  GROUP BY contact.account_id
  HAVING COUNT(DISTINCT contact.company_id) = 1
)
UPDATE accounts AS account
SET company_id = candidate.company_id
FROM account_company AS candidate
WHERE candidate.account_id = account.account_id
  AND account.company_id IS NULL;

WITH source_company AS (
  SELECT lead.source_id, MIN(lead.company_id) AS company_id
  FROM leads AS lead
  WHERE lead.source_id IS NOT NULL AND lead.company_id IS NOT NULL
  GROUP BY lead.source_id
  HAVING COUNT(DISTINCT lead.company_id) = 1
)
UPDATE lead_sources AS source
SET company_id = candidate.company_id
FROM source_company AS candidate
WHERE candidate.source_id = source.source_id
  AND source.company_id IS NULL;

WITH campaign_company AS (
  SELECT lead.campaign_id, MIN(lead.company_id) AS company_id
  FROM leads AS lead
  WHERE lead.campaign_id IS NOT NULL AND lead.company_id IS NOT NULL
  GROUP BY lead.campaign_id
  HAVING COUNT(DISTINCT lead.company_id) = 1
)
UPDATE campaigns AS campaign
SET company_id = candidate.company_id
FROM campaign_company AS candidate
WHERE candidate.campaign_id = campaign.campaign_id
  AND campaign.company_id IS NULL;

WITH tag_company AS (
  SELECT lead_tag.tag_id, MIN(lead.company_id) AS company_id
  FROM lead_tags AS lead_tag
  JOIN leads AS lead ON lead.lead_id = lead_tag.lead_id
  WHERE lead.company_id IS NOT NULL
  GROUP BY lead_tag.tag_id
  HAVING COUNT(DISTINCT lead.company_id) = 1
)
UPDATE tags AS tag
SET company_id = candidate.company_id
FROM tag_company AS candidate
WHERE candidate.tag_id = tag.tag_id
  AND tag.company_id IS NULL;

UPDATE lead_intake_events AS intake
SET company_id = lead.company_id
FROM leads AS lead
WHERE lead.lead_id = intake.lead_id
  AND intake.company_id IS NULL;

WITH role_company AS (
  SELECT user_record.role_id, MIN(team.company_id) AS company_id
  FROM users AS user_record
  JOIN teams AS team ON team.team_id = user_record.team_id
  GROUP BY user_record.role_id
  HAVING COUNT(DISTINCT team.company_id) = 1
)
UPDATE roles AS role
SET company_id = candidate.company_id
FROM role_company AS candidate
WHERE role.role_id = candidate.role_id
  AND role.is_system_role = FALSE
  AND role.company_id IS NULL;

DO $$
DECLARE
  only_company_id INTEGER;
BEGIN
  IF (SELECT COUNT(*) FROM companies WHERE archived_at IS NULL) = 1 THEN
    SELECT company_id INTO only_company_id
    FROM companies
    WHERE archived_at IS NULL;

    UPDATE accounts SET company_id = only_company_id WHERE company_id IS NULL;
    UPDATE contacts SET company_id = only_company_id WHERE company_id IS NULL;
    UPDATE lead_sources SET company_id = only_company_id WHERE company_id IS NULL;
    UPDATE campaigns SET company_id = only_company_id WHERE company_id IS NULL;
    UPDATE tags SET company_id = only_company_id WHERE company_id IS NULL;
    UPDATE lead_intake_events SET company_id = only_company_id WHERE company_id IS NULL;
    UPDATE roles
    SET company_id = only_company_id
    WHERE company_id IS NULL AND is_system_role = FALSE;
  END IF;
END;
$$;

DO $$
DECLARE
  unresolved TEXT;
BEGIN
  SELECT STRING_AGG(table_name || '=' || missing_count, ', ')
  INTO unresolved
  FROM (
    SELECT 'accounts' AS table_name, COUNT(*)::TEXT AS missing_count FROM accounts WHERE company_id IS NULL
    UNION ALL SELECT 'contacts', COUNT(*)::TEXT FROM contacts WHERE company_id IS NULL
    UNION ALL SELECT 'lead_sources', COUNT(*)::TEXT FROM lead_sources WHERE company_id IS NULL
    UNION ALL SELECT 'campaigns', COUNT(*)::TEXT FROM campaigns WHERE company_id IS NULL
    UNION ALL SELECT 'tags', COUNT(*)::TEXT FROM tags WHERE company_id IS NULL
    UNION ALL SELECT 'lead_intake_events', COUNT(*)::TEXT FROM lead_intake_events WHERE company_id IS NULL
    UNION ALL SELECT 'leads', COUNT(*)::TEXT FROM leads WHERE company_id IS NULL
    UNION ALL SELECT 'custom_roles', COUNT(*)::TEXT FROM roles WHERE company_id IS NULL AND is_system_role = FALSE
  ) AS counts
  WHERE missing_count <> '0';

  IF unresolved IS NOT NULL THEN
    RAISE EXCEPTION
      'Tenant backfill is ambiguous. Assign company_id before retrying: %',
      unresolved;
  END IF;
END;
$$;

ALTER TABLE accounts ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE contacts ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE lead_sources ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE campaigns ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE tags ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE lead_intake_events ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE leads ALTER COLUMN company_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='roles_company_ownership_check' AND conrelid='roles'::regclass
  ) THEN
    ALTER TABLE roles ADD CONSTRAINT roles_company_ownership_check CHECK (
      (is_system_role=TRUE AND company_id IS NULL)
      OR (is_system_role=FALSE AND company_id IS NOT NULL)
    );
  END IF;
END;
$$;

ALTER TABLE lead_intake_events
  DROP CONSTRAINT IF EXISTS lead_intake_events_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS lead_intake_events_company_idempotency_uidx
  ON lead_intake_events (company_id, idempotency_key);

CREATE INDEX IF NOT EXISTS accounts_company_idx ON accounts (company_id);
CREATE INDEX IF NOT EXISTS contacts_company_idx ON contacts (company_id);
CREATE INDEX IF NOT EXISTS lead_sources_company_idx ON lead_sources (company_id);
CREATE INDEX IF NOT EXISTS campaigns_company_idx ON campaigns (company_id);
CREATE INDEX IF NOT EXISTS tags_company_idx ON tags (company_id);
CREATE INDEX IF NOT EXISTS lead_intake_events_company_idx
  ON lead_intake_events (company_id, received_at DESC);
CREATE INDEX IF NOT EXISTS leads_company_idx
  ON leads (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS roles_company_idx
  ON roles (company_id, role_name) WHERE company_id IS NOT NULL;

ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_role_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS roles_system_key_uidx
  ON roles (LOWER(role_key)) WHERE is_system_role=TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS roles_company_key_uidx
  ON roles (company_id, LOWER(role_key)) WHERE is_system_role=FALSE;

COMMIT;
