-- Apply this migration in Supabase after restoring the existing public schema
-- and data. It is intentionally non-destructive: existing CRM user IDs remain
-- stable and are linked to Supabase Auth through users.auth_user_id.

BEGIN;

-- Keep PostgREST's browser-facing roles separate from the role assumed by the
-- trusted Next.js backend. The role cannot log in directly and is only granted
-- to Supabase's postgres connection user.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sthyra_app_server') THEN
    CREATE ROLE sthyra_app_server NOLOGIN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'sthyra_app_server'
      AND (
        rolcanlogin
        OR rolsuper
        OR rolcreatedb
        OR rolcreaterole
        OR rolreplication
        OR rolbypassrls
      )
  ) THEN
    RAISE EXCEPTION
      'sthyra_app_server must be NOLOGIN and have no elevated role attributes';
  END IF;
END;
$$;
GRANT sthyra_app_server TO postgres;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_uidx
  ON users (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS workspace_memberships (
  membership_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  crm_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (auth_user_id, company_id),
  UNIQUE (crm_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_memberships_one_default_uidx
  ON workspace_memberships (auth_user_id)
  WHERE is_active AND is_default;
CREATE INDEX IF NOT EXISTS workspace_memberships_company_idx
  ON workspace_memberships (company_id, is_active, crm_user_id);

CREATE OR REPLACE FUNCTION private.sync_workspace_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  target_company_id INTEGER;
BEGIN
  IF NEW.auth_user_id IS NULL OR NEW.team_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT team.company_id
  INTO target_company_id
  FROM teams AS team
  WHERE team.team_id = NEW.team_id;

  IF target_company_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve a company for CRM user %', NEW.user_id;
  END IF;

  INSERT INTO workspace_memberships (
    auth_user_id,
    crm_user_id,
    company_id,
    is_active,
    is_default
  ) VALUES (
    NEW.auth_user_id,
    NEW.user_id,
    target_company_id,
    NEW.is_active AND NEW.deleted_at IS NULL,
    TRUE
  )
  ON CONFLICT (crm_user_id) DO UPDATE
  SET auth_user_id = EXCLUDED.auth_user_id,
      company_id = EXCLUDED.company_id,
      is_active = EXCLUDED.is_active,
      is_default = TRUE,
      updated_at = CURRENT_TIMESTAMP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_sync_workspace_membership ON users;
CREATE TRIGGER users_sync_workspace_membership
AFTER INSERT OR UPDATE OF auth_user_id, team_id, is_active, deleted_at
ON users
FOR EACH ROW
EXECUTE FUNCTION private.sync_workspace_membership();

-- Link identities that were created in Supabase before this migration.
UPDATE users AS crm_user
SET auth_user_id = auth_user.id
FROM auth.users AS auth_user
WHERE crm_user.auth_user_id IS NULL
  AND crm_user.deleted_at IS NULL
  AND LOWER(crm_user.email) = LOWER(auth_user.email);

-- Tenant keys that were missing from the original single-workspace schema.
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

-- A dump from the original application normally contains one company. Use it
-- to place records that have not yet been linked to a lead.
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

ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_company_ownership_check;
ALTER TABLE roles
  ADD CONSTRAINT roles_company_ownership_check CHECK (
    (is_system_role=TRUE AND company_id IS NULL)
    OR (is_system_role=FALSE AND company_id IS NOT NULL)
  );

ALTER TABLE accounts
  ADD CONSTRAINT accounts_company_fk
  FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_company_fk
  FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE;
ALTER TABLE lead_sources
  ADD CONSTRAINT lead_sources_company_fk
  FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE;
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_company_fk
  FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE;
ALTER TABLE tags
  ADD CONSTRAINT tags_company_fk
  FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE;
ALTER TABLE lead_intake_events
  ADD CONSTRAINT lead_intake_events_company_fk
  FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE;
ALTER TABLE leads
  ADD CONSTRAINT leads_company_fk
  FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE;
ALTER TABLE roles
  ADD CONSTRAINT roles_company_fk
  FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_company_id_uidx
  ON accounts (company_id, account_id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_company_id_uidx
  ON contacts (company_id, contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS projects_company_id_uidx
  ON projects (company_id, project_id);
CREATE UNIQUE INDEX IF NOT EXISTS lead_sources_company_id_uidx
  ON lead_sources (company_id, source_id);
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_company_id_uidx
  ON campaigns (company_id, campaign_id);
CREATE UNIQUE INDEX IF NOT EXISTS tags_company_id_uidx
  ON tags (company_id, tag_id);

ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_role_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS roles_system_key_uidx
  ON roles (LOWER(role_key)) WHERE is_system_role=TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS roles_company_key_uidx
  ON roles (company_id, LOWER(role_key)) WHERE is_system_role=FALSE;
CREATE INDEX IF NOT EXISTS roles_company_idx
  ON roles (company_id, role_name) WHERE company_id IS NOT NULL;

ALTER TABLE lead_intake_events
  DROP CONSTRAINT IF EXISTS lead_intake_events_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS lead_intake_events_company_idempotency_uidx
  ON lead_intake_events (company_id, idempotency_key);

ALTER TABLE lead_sources DROP CONSTRAINT IF EXISTS lead_sources_code_key;
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_campaign_code_key;
DROP INDEX IF EXISTS tags_active_name_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS lead_sources_company_code_uidx
  ON lead_sources (company_id, LOWER(code));
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_company_code_uidx
  ON campaigns (company_id, LOWER(campaign_code));
CREATE UNIQUE INDEX IF NOT EXISTS tags_company_active_name_uidx
  ON tags (company_id, LOWER(tag_name))
  WHERE archived_at IS NULL;

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_contact_id_fkey,
  DROP CONSTRAINT IF EXISTS leads_project_id_fkey,
  DROP CONSTRAINT IF EXISTS leads_source_id_fkey,
  DROP CONSTRAINT IF EXISTS leads_campaign_id_fkey;
ALTER TABLE leads
  ADD CONSTRAINT leads_company_contact_fk
    FOREIGN KEY (company_id, contact_id)
    REFERENCES contacts(company_id, contact_id) ON DELETE RESTRICT,
  ADD CONSTRAINT leads_company_project_fk
    FOREIGN KEY (company_id, project_id)
    REFERENCES projects(company_id, project_id) ON DELETE RESTRICT,
  ADD CONSTRAINT leads_company_source_fk
    FOREIGN KEY (company_id, source_id)
    REFERENCES lead_sources(company_id, source_id) ON DELETE SET NULL (source_id),
  ADD CONSTRAINT leads_company_campaign_fk
    FOREIGN KEY (company_id, campaign_id)
    REFERENCES campaigns(company_id, campaign_id) ON DELETE SET NULL (campaign_id);

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_account_id_fkey;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_company_account_fk
  FOREIGN KEY (company_id, account_id)
  REFERENCES accounts(company_id, account_id) ON DELETE SET NULL (account_id);

CREATE OR REPLACE FUNCTION private.current_crm_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT membership.crm_user_id
  FROM workspace_memberships AS membership
  WHERE membership.auth_user_id = (SELECT auth.uid())
    AND membership.is_active
  ORDER BY membership.is_default DESC, membership.joined_at
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.is_trusted_app_request()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, pg_temp
AS $$
  SELECT COALESCE((SELECT auth.jwt() ->> 'app_server') = 'true', FALSE)
$$;

CREATE OR REPLACE FUNCTION private.is_company_member(target_company_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_memberships AS membership
    WHERE membership.auth_user_id = (SELECT auth.uid())
      AND membership.company_id = target_company_id
      AND membership.is_active
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_project(target_project_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM projects AS project
    JOIN workspace_memberships AS membership
      ON membership.company_id = project.company_id
     AND membership.auth_user_id = (SELECT auth.uid())
     AND membership.is_active
    JOIN users AS crm_user ON crm_user.user_id = membership.crm_user_id
    JOIN roles AS role ON role.role_id = crm_user.role_id
    WHERE project.project_id = target_project_id
      AND (
        role.role_key IN ('COMPANY_OWNER', 'COMPANY_ADMIN', 'SUPER_ADMIN')
        OR EXISTS (
          SELECT 1 FROM user_projects AS user_project
          WHERE user_project.user_id = crm_user.user_id
            AND user_project.project_id = project.project_id
        )
        OR EXISTS (
          SELECT 1 FROM team_projects AS team_project
          WHERE team_project.team_id = crm_user.team_id
            AND team_project.project_id = project.project_id
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_user(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users AS crm_user
    JOIN teams AS team ON team.team_id = crm_user.team_id
    WHERE crm_user.user_id = target_user_id
      AND private.is_company_member(team.company_id)
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_team(target_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM teams AS team
    WHERE team.team_id = target_team_id
      AND private.is_company_member(team.company_id)
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_contact(target_contact_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM contacts AS contact
    WHERE contact.contact_id = target_contact_id
      AND private.is_company_member(contact.company_id)
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_lead(target_lead_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM leads AS lead
    WHERE lead.lead_id = target_lead_id
      AND private.is_company_member(lead.company_id)
      AND private.can_access_project(lead.project_id)
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_opportunity(target_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM opportunities AS opportunity
    WHERE opportunity.opportunity_id = target_id
      AND private.is_company_member(opportunity.company_id)
      AND private.can_access_project(opportunity.project_id)
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_appointment(target_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM appointments AS appointment
    WHERE appointment.appointment_id = target_id
      AND private.is_company_member(appointment.company_id)
      AND private.can_access_project(appointment.project_id)
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_inventory_unit(target_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM inventory_units AS unit
    WHERE unit.unit_id = target_id
      AND private.is_company_member(unit.company_id)
      AND private.can_access_project(unit.project_id)
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_call(target_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM calls AS call
    WHERE call.call_id = target_id
      AND private.is_company_member(call.company_id)
      AND private.can_access_project(call.project_id)
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_assignment(target_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM assignments AS assignment
    WHERE assignment.assignment_id = target_id
      AND private.is_company_member(assignment.company_id)
      AND private.can_access_project(assignment.project_id)
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_queue(target_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM queues AS queue
    WHERE queue.queue_id = target_id
      AND private.is_company_member(queue.company_id)
      AND (queue.project_id IS NULL OR private.can_access_project(queue.project_id))
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_sla(target_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM sla_instances AS instance
    WHERE instance.sla_id = target_id
      AND private.is_company_member(instance.company_id)
      AND private.can_access_project(instance.project_id)
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_transfer(target_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM transfers AS transfer
    WHERE transfer.transfer_id = target_id
      AND private.is_company_member(transfer.company_id)
      AND private.can_access_project(transfer.project_id)
  )
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO sthyra_app_server, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO sthyra_app_server, service_role;

-- Deny by default. A table becomes reachable only when an explicit policy is
-- added below.
DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE FORMAT('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.table_name);
  END LOOP;
END;
$$;

DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('companies', 'private.is_company_member(company_id)'),
      ('workspace_memberships', 'private.is_company_member(company_id)'),
      ('teams', 'private.is_company_member(company_id)'),
      ('accounts', 'private.is_company_member(company_id)'),
      ('contacts', 'private.is_company_member(company_id)'),
      ('lead_sources', 'private.is_company_member(company_id)'),
      ('campaigns', 'private.is_company_member(company_id)'),
      ('tags', 'private.is_company_member(company_id)'),
      ('lead_intake_events', 'private.is_company_member(company_id)'),
      ('leads', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('activities', 'private.is_company_member(company_id) AND (project_id IS NULL OR private.can_access_project(project_id))'),
      ('appointments', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('assignments', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('calls', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('email_attachments', 'private.is_company_member(company_id) AND (project_id IS NULL OR private.can_access_project(project_id))'),
      ('email_connections', 'private.is_company_member(company_id) AND private.can_access_user(user_id)'),
      ('email_delivery_jobs', 'private.is_company_member(company_id)'),
      ('emails', 'private.is_company_member(company_id) AND (project_id IS NULL OR private.can_access_project(project_id))'),
      ('inventory_asset_types', 'private.is_company_member(company_id)'),
      ('inventory_attribute_definitions', 'private.is_company_member(company_id) AND (project_id IS NULL OR private.can_access_project(project_id))'),
      ('inventory_floor_plans', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('inventory_holds', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('inventory_import_jobs', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('inventory_price_books', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('inventory_reservations', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('inventory_unit_types', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('inventory_units', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('notification_templates', 'private.is_company_member(company_id) AND (project_id IS NULL OR private.can_access_project(project_id))'),
      ('notifications', 'private.is_company_member(company_id) AND private.can_access_user(user_id)'),
      ('notes', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('opportunities', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('project_inventory_nodes', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('queues', 'private.is_company_member(company_id) AND (project_id IS NULL OR private.can_access_project(project_id))'),
      ('routing_rules', 'private.is_company_member(company_id) AND (project_id IS NULL OR private.can_access_project(project_id))'),
      ('site_visit_availability_rules', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('sla_instances', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('sla_rules', 'private.is_company_member(company_id) AND (project_id IS NULL OR private.can_access_project(project_id))'),
      ('tasks', 'private.is_company_member(company_id) AND (project_id IS NULL OR private.can_access_project(project_id))'),
      ('telephony_agent_presence', 'private.is_company_member(company_id) AND (project_id IS NULL OR private.can_access_project(project_id))'),
      ('telephony_phone_numbers', 'private.is_company_member(company_id) AND (project_id IS NULL OR private.can_access_project(project_id))'),
      ('transfer_checklist_templates', 'private.is_company_member(company_id) AND (project_id IS NULL OR private.can_access_project(project_id))'),
      ('transfers', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
      ('workspace_invitations', 'private.is_company_member(company_id)')
    ) AS policies(table_name, expression)
  LOOP
    EXECUTE FORMAT('DROP POLICY IF EXISTS tenant_isolation ON public.%I', target.table_name);
    EXECUTE FORMAT('DROP POLICY IF EXISTS tenant_select ON public.%I', target.table_name);
    EXECUTE FORMAT('DROP POLICY IF EXISTS tenant_server_write ON public.%I', target.table_name);
    EXECUTE FORMAT(
      'CREATE POLICY tenant_select ON public.%I FOR SELECT TO sthyra_app_server USING (%s)',
      target.table_name,
      target.expression
    );
    EXECUTE FORMAT(
      'CREATE POLICY tenant_server_write ON public.%I FOR ALL TO sthyra_app_server USING ((%s) AND private.is_trusted_app_request()) WITH CHECK ((%s) AND private.is_trusted_app_request())',
      target.table_name, target.expression, target.expression
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('projects', 'private.can_access_project(project_id)'),
      ('phases', 'private.can_access_project(project_id)'),
      ('project_lead_configurations', 'private.can_access_project(project_id)'),
      ('project_lead_stages', 'private.can_access_project(project_id)'),
      ('project_opportunity_stages', 'private.can_access_project(project_id)'),
      ('project_qualification_fields', 'private.can_access_project(project_id)'),
      ('project_closing_reasons', 'private.can_access_project(project_id)'),
      ('users', 'private.can_access_user(user_id)'),
      ('user_projects', 'private.can_access_user(user_id) AND private.can_access_project(project_id)'),
      ('user_availability', 'private.can_access_user(user_id)'),
      ('user_leaves', 'private.can_access_user(user_id)'),
      ('user_preferences', 'user_id = private.current_crm_user_id()'),
      ('notification_preferences', 'user_id = private.current_crm_user_id()'),
      ('team_projects', 'private.can_access_team(team_id) AND private.can_access_project(project_id)'),
      ('contact_aliases', 'private.can_access_contact(contact_id)'),
      ('contact_consents', 'private.can_access_contact(contact_id)'),
      ('contact_timeline_events', 'private.can_access_contact(contact_id)'),
      ('contact_duplicate_exclusions', 'private.can_access_contact(contact_id_low) AND private.can_access_contact(contact_id_high)'),
      ('contact_merge_history', 'private.can_access_contact(survivor_contact_id) AND private.can_access_contact(duplicate_contact_id)'),
      ('contact_relationships', 'private.can_access_contact(contact_id) AND private.can_access_contact(related_contact_id)'),
      ('lead_attributions', 'private.can_access_lead(lead_id)'),
      ('lead_next_action_history', 'private.can_access_lead(lead_id)'),
      ('lead_next_actions', 'private.can_access_lead(lead_id)'),
      ('lead_ownership_history', 'private.can_access_lead(lead_id)'),
      ('lead_state_history', 'private.can_access_lead(lead_id)'),
      ('lead_tag_history', 'private.can_access_lead(lead_id)'),
      ('lead_tags', 'private.can_access_lead(lead_id) AND EXISTS (SELECT 1 FROM tags AS tag WHERE tag.tag_id = lead_tags.tag_id AND private.is_company_member(tag.company_id))'),
      ('assignment_history', 'private.can_access_assignment(assignment_id)'),
      ('call_state_history', 'private.can_access_call(call_id)'),
      ('call_transfers', 'private.can_access_call(call_id)'),
      ('queue_members', 'private.can_access_queue(queue_id) AND private.can_access_user(user_id)'),
      ('queue_records', 'private.can_access_queue(queue_id) AND private.can_access_lead(lead_id)'),
      ('sla_instance_history', 'private.can_access_sla(sla_id)'),
      ('opportunity_ownership_history', 'private.can_access_opportunity(opportunity_id)'),
      ('opportunity_quotations', 'private.can_access_opportunity(opportunity_id)'),
      ('opportunity_shortlists', 'private.can_access_opportunity(opportunity_id)'),
      ('opportunity_state_history', 'private.can_access_opportunity(opportunity_id)'),
      ('site_visits', 'private.can_access_appointment(visit_id)'),
      ('site_visit_participants', 'private.can_access_appointment(visit_id)'),
      ('site_visit_state_history', 'private.can_access_appointment(visit_id)'),
      ('site_visit_units_shown', 'private.can_access_appointment(visit_id) AND private.can_access_inventory_unit(unit_id)'),
      ('inventory_floor_plan_assets', 'EXISTS (SELECT 1 FROM inventory_floor_plans AS plan WHERE plan.floor_plan_id = inventory_floor_plan_assets.floor_plan_id AND private.is_company_member(plan.company_id) AND private.can_access_project(plan.project_id))'),
      ('inventory_import_rows', 'EXISTS (SELECT 1 FROM inventory_import_jobs AS job WHERE job.import_id = inventory_import_rows.import_id AND private.is_company_member(job.company_id) AND private.can_access_project(job.project_id))'),
      ('inventory_price_book_entries', 'EXISTS (SELECT 1 FROM inventory_price_books AS book WHERE book.price_book_id = inventory_price_book_entries.price_book_id AND private.is_company_member(book.company_id) AND private.can_access_project(book.project_id))'),
      ('inventory_unit_status_history', 'private.can_access_inventory_unit(unit_id)'),
      ('inventory_unit_type_floor_plans', 'EXISTS (SELECT 1 FROM inventory_unit_types AS unit_type WHERE unit_type.unit_type_id = inventory_unit_type_floor_plans.unit_type_id AND private.is_company_member(unit_type.company_id) AND private.can_access_project(unit_type.project_id))'),
      ('notification_deliveries', 'user_id = private.current_crm_user_id()'),
      ('transfer_history', 'private.can_access_transfer(transfer_id)'),
      ('transfer_checklist_items', 'private.can_access_transfer(transfer_id)'),
      ('transfer_checklist_template_items', 'EXISTS (SELECT 1 FROM transfer_checklist_templates AS template WHERE template.template_id = transfer_checklist_template_items.template_id AND private.is_company_member(template.company_id) AND (template.project_id IS NULL OR private.can_access_project(template.project_id)))')
    ) AS policies(table_name, expression)
  LOOP
    EXECUTE FORMAT('DROP POLICY IF EXISTS tenant_isolation ON public.%I', target.table_name);
    EXECUTE FORMAT('DROP POLICY IF EXISTS tenant_select ON public.%I', target.table_name);
    EXECUTE FORMAT('DROP POLICY IF EXISTS tenant_server_write ON public.%I', target.table_name);
    EXECUTE FORMAT(
      'CREATE POLICY tenant_select ON public.%I FOR SELECT TO sthyra_app_server USING (%s)',
      target.table_name,
      target.expression
    );
    EXECUTE FORMAT(
      'CREATE POLICY tenant_server_write ON public.%I FOR ALL TO sthyra_app_server USING ((%s) AND private.is_trusted_app_request()) WITH CHECK ((%s) AND private.is_trusted_app_request())',
      target.table_name, target.expression, target.expression
    );
  END LOOP;
END;
$$;

-- Shared reference data is readable only by the tenant-scoped application role.
DROP POLICY IF EXISTS authenticated_read_regions ON regions;
CREATE POLICY authenticated_read_regions
  ON regions FOR SELECT TO sthyra_app_server USING (TRUE);
DROP POLICY IF EXISTS authenticated_read_permissions ON permissions;
CREATE POLICY authenticated_read_permissions
  ON permissions FOR SELECT TO sthyra_app_server USING (TRUE);

DROP POLICY IF EXISTS authenticated_read_roles ON roles;
DROP POLICY IF EXISTS tenant_select ON roles;
DROP POLICY IF EXISTS tenant_server_write ON roles;
CREATE POLICY tenant_select ON roles
  FOR SELECT TO sthyra_app_server
  USING (is_system_role OR private.is_company_member(company_id));
CREATE POLICY tenant_server_write ON roles
  FOR ALL TO sthyra_app_server
  USING (
    NOT is_system_role
    AND private.is_company_member(company_id)
    AND private.is_trusted_app_request()
  )
  WITH CHECK (
    NOT is_system_role
    AND private.is_company_member(company_id)
    AND private.is_trusted_app_request()
  );

DROP POLICY IF EXISTS authenticated_read_role_permissions ON role_permissions;
DROP POLICY IF EXISTS tenant_select ON role_permissions;
DROP POLICY IF EXISTS tenant_server_write ON role_permissions;
CREATE POLICY tenant_select ON role_permissions
  FOR SELECT TO sthyra_app_server
  USING (
    EXISTS (
      SELECT 1 FROM roles AS role
      WHERE role.role_id=role_permissions.role_id
        AND (
          role.is_system_role
          OR private.is_company_member(role.company_id)
        )
    )
  );
CREATE POLICY tenant_server_write ON role_permissions
  FOR ALL TO sthyra_app_server
  USING (
    private.is_trusted_app_request()
    AND EXISTS (
      SELECT 1 FROM roles AS role
      WHERE role.role_id=role_permissions.role_id
        AND NOT role.is_system_role
        AND private.is_company_member(role.company_id)
    )
  )
  WITH CHECK (
    private.is_trusted_app_request()
    AND EXISTS (
      SELECT 1 FROM roles AS role
      WHERE role.role_id=role_permissions.role_id
        AND NOT role.is_system_role
        AND private.is_company_member(role.company_id)
    )
  );

-- telephony_events, auth_sessions, password_reset_tokens and auth_identities
-- are intentionally service-only. No authenticated policy is created.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
GRANT USAGE ON SCHEMA public TO sthyra_app_server, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sthyra_app_server;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sthyra_app_server;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Future tables fail closed until their tenant policy is added deliberately.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated, sthyra_app_server;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated, sthyra_app_server;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;

COMMIT;
