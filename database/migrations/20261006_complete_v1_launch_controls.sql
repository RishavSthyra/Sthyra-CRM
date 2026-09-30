BEGIN;

-- The Supabase multitenancy foundation normally creates this schema first.
-- Keep this migration runnable against a standalone/local PostgreSQL database
-- as well; tenant RLS policies are installed below only when all foundation
-- helpers are available.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- Shared, PostgreSQL-backed rate limits work across every Vercel instance.
-- subject_hash is an application-keyed HMAC. Raw IPs, emails and tokens are
-- intentionally never persisted.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  action VARCHAR(50) NOT NULL,
  subject_hash VARCHAR(64) NOT NULL,
  bucket_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (action, subject_hash, bucket_started_at),
  CONSTRAINT auth_rate_limits_action_not_blank CHECK (BTRIM(action) <> ''),
  CONSTRAINT auth_rate_limits_count_positive CHECK (request_count > 0)
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_cleanup_idx
  ON auth_rate_limits (bucket_started_at);

ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_rate_limits FORCE ROW LEVEL SECURITY;

-- One canonical hostname per tenant. Provisioning state is retained so a
-- transient Vercel API error never prevents the company itself being created.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS workspace_slug VARCHAR(63);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS workspace_domain VARCHAR(253);
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS workspace_domain_status VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS workspace_domain_error TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS workspace_domain_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'companies_workspace_domain_status_check'
      AND conrelid = 'companies'::regclass
  ) THEN
    ALTER TABLE companies ADD CONSTRAINT companies_workspace_domain_status_check
      CHECK (workspace_domain_status IN ('pending', 'provisioning', 'active', 'error', 'disabled'));
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS companies_workspace_slug_uidx
  ON companies (LOWER(workspace_slug)) WHERE workspace_slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS companies_workspace_domain_uidx
  ON companies (LOWER(workspace_domain)) WHERE workspace_domain IS NOT NULL;

-- Canonical permission catalogue for V1. Custom roles may receive any subset.
INSERT INTO roles (role_key, role_name, description, is_system_role)
VALUES
  ('COMPANY_ADMIN', 'Company Admin', 'Workspace administrator without super-admin audit access', TRUE),
  ('SUPER_ADMIN', 'Super Admin', 'Highest-trust workspace administrator with audit access', TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO permissions (
  permission_key, permission_name, feature_key, action, description
) VALUES
  ('WORKSPACE_MANAGE', 'Manage workspace', 'WORKSPACE', 'manage', 'Manage company-level workspace settings'),
  ('PEOPLE_MANAGE', 'Manage people and access', 'PEOPLE', 'manage', 'Invite people and manage teams and roles'),
  ('PROJECTS_MANAGE', 'Manage projects', 'PROJECTS', 'manage', 'Create and configure projects'),
  ('LEADS_VIEW', 'View leads', 'LEADS', 'view', 'View accessible leads'),
  ('LEADS_CREATE', 'Create leads', 'LEADS', 'create', 'Create and import leads'),
  ('LEADS_UPDATE', 'Update leads', 'LEADS', 'update', 'Update accessible leads'),
  ('LEADS_ASSIGN', 'Assign leads', 'LEADS', 'assign', 'Assign and transfer leads'),
  ('OPPORTUNITIES_MANAGE', 'Manage opportunities', 'OPPORTUNITIES', 'manage', 'Create and update opportunities'),
  ('INVENTORY_MANAGE', 'Manage inventory', 'INVENTORY', 'manage', 'Create and update inventory'),
  ('ACTIVITIES_MANAGE', 'Manage activities', 'ACTIVITIES', 'manage', 'Create and update CRM activities'),
  ('REPORTS_VIEW', 'View reports', 'REPORTS', 'view', 'View workspace reporting'),
  ('DATA_EXPORT', 'Export data', 'DATA', 'export', 'Export tenant CRM data'),
  ('DATA_IMPORT', 'Import data', 'DATA', 'import', 'Validate and import tenant CRM data'),
  ('AUDIT_VIEW', 'View audit log', 'AUDIT', 'view', 'View detailed tenant audit history')
ON CONFLICT (permission_key) DO UPDATE SET
  permission_name = EXCLUDED.permission_name,
  feature_key = EXCLUDED.feature_key,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.role_id, permission.permission_id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.role_key IN ('COMPANY_OWNER', 'COMPANY_ADMIN', 'SUPER_ADMIN')
  AND (permission.permission_key <> 'AUDIT_VIEW' OR role.role_key = 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  action VARCHAR(10) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id TEXT,
  changed_fields TEXT[] NOT NULL DEFAULT '{}',
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT audit_logs_action_check CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  CONSTRAINT audit_logs_old_object CHECK (old_values IS NULL OR jsonb_typeof(old_values) = 'object'),
  CONSTRAINT audit_logs_new_object CHECK (new_values IS NULL OR jsonb_typeof(new_values) = 'object')
);

CREATE INDEX IF NOT EXISTS audit_logs_company_time_idx
  ON audit_logs (company_id, created_at DESC, audit_id DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
  ON audit_logs (company_id, entity_type, entity_id, created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.capture_tenant_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  before_row JSONB := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  after_row JSONB := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  source_row JSONB := COALESCE(after_row, before_row);
  tenant_id INTEGER;
  actor_id UUID;
  identifier TEXT;
  changed TEXT[] := '{}';
  redacted_keys TEXT[] := ARRAY[
    'password_hash', 'refresh_token_hash', 'token_hash', 'access_token_ciphertext',
    'refresh_token_ciphertext', 'submission_secret_hash', 'webhook_secret_hash'
  ];
BEGIN
  tenant_id := NULLIF(source_row ->> 'company_id', '')::INTEGER;

  IF tenant_id IS NULL AND source_row ? 'project_id' THEN
    SELECT company_id INTO tenant_id
    FROM projects WHERE project_id = NULLIF(source_row ->> 'project_id', '')::INTEGER;
  END IF;
  IF tenant_id IS NULL AND source_row ? 'team_id' THEN
    SELECT company_id INTO tenant_id
    FROM teams WHERE team_id = NULLIF(source_row ->> 'team_id', '')::UUID;
  END IF;
  IF tenant_id IS NULL AND TG_TABLE_NAME IN ('roles', 'role_permissions') THEN
    SELECT company_id INTO tenant_id
    FROM roles
    WHERE role_id = NULLIF(source_row ->> 'role_id', '')::UUID;
  END IF;
  IF tenant_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TO_REGPROCEDURE('private.current_crm_user_id()') IS NOT NULL THEN
    actor_id := private.current_crm_user_id();
  END IF;

  IF TG_NARGS > 0 AND TG_ARGV[0] <> '' THEN
    identifier := source_row ->> TG_ARGV[0];
  END IF;

  before_row := before_row - redacted_keys;
  after_row := after_row - redacted_keys;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(key ORDER BY key), '{}') INTO changed
    FROM jsonb_object_keys(after_row) AS key
    WHERE before_row -> key IS DISTINCT FROM after_row -> key;
    IF COALESCE(array_length(changed, 1), 0) = 0 THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT COALESCE(array_agg(key ORDER BY key), '{}') INTO changed
    FROM jsonb_object_keys(after_row) AS key;
  ELSE
    SELECT COALESCE(array_agg(key ORDER BY key), '{}') INTO changed
    FROM jsonb_object_keys(before_row) AS key;
  END IF;

  INSERT INTO audit_logs (
    company_id, actor_user_id, action, entity_type, entity_id,
    changed_fields, old_values, new_values
  ) VALUES (
    tenant_id, actor_id, TG_OP, TG_TABLE_NAME, identifier,
    changed, before_row, after_row
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- This security-definer function is a trigger implementation, not a public
-- RPC endpoint.
REVOKE ALL ON FUNCTION private.capture_tenant_audit_log() FROM PUBLIC;

DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('companies', 'company_id'),
      ('projects', 'project_id'),
      ('users', 'user_id'),
      ('teams', 'team_id'),
      ('roles', 'role_id'),
      ('role_permissions', 'role_id'),
      ('contacts', 'contact_id'),
      ('leads', 'lead_id'),
      ('opportunities', 'opportunity_id'),
      ('tasks', 'task_id'),
      ('appointments', 'appointment_id'),
      ('activities', 'activity_id'),
      ('site_visits', 'site_visit_id'),
      ('inventory_units', 'unit_id'),
      ('assignments', 'assignment_id'),
      ('transfers', 'transfer_id'),
      ('lead_sources', 'source_id'),
      ('campaigns', 'campaign_id'),
      ('tags', 'tag_id'),
      ('queues', 'queue_id'),
      ('routing_rules', 'rule_id'),
      ('sla_rules', 'sla_rule_id'),
      ('marketing_forms', 'form_id'),
      ('marketing_integrations', 'integration_id')
    ) AS entries(table_name, id_column)
  LOOP
    IF TO_REGCLASS('public.' || target.table_name) IS NOT NULL THEN
      EXECUTE FORMAT('DROP TRIGGER IF EXISTS tenant_audit_log ON public.%I', target.table_name);
      EXECUTE FORMAT(
        'CREATE TRIGGER tenant_audit_log AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.capture_tenant_audit_log(%L)',
        target.table_name,
        target.id_column
      );
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sthyra_app_server') THEN
    REVOKE ALL ON auth_rate_limits FROM sthyra_app_server;
    REVOKE INSERT, UPDATE, DELETE ON audit_logs FROM sthyra_app_server;
    GRANT SELECT ON audit_logs TO sthyra_app_server;

    DROP POLICY IF EXISTS super_admin_select ON audit_logs;
    IF TO_REGPROCEDURE('private.is_company_member(integer)') IS NOT NULL
       AND TO_REGPROCEDURE('private.current_crm_user_id()') IS NOT NULL THEN
      CREATE POLICY super_admin_select ON audit_logs
        FOR SELECT TO sthyra_app_server
        USING (
          private.is_company_member(company_id)
          AND EXISTS (
            SELECT 1
            FROM users app_user
            JOIN roles app_role ON app_role.role_id = app_user.role_id
            WHERE app_user.user_id = private.current_crm_user_id()
              AND app_role.role_key = 'SUPER_ADMIN'
          )
        );
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON auth_rate_limits, audit_logs TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON auth_rate_limits, audit_logs FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON auth_rate_limits, audit_logs FROM authenticated;
  END IF;
END;
$$;

COMMIT;
