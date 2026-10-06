BEGIN;

CREATE TABLE IF NOT EXISTS communication_threads (
  thread_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  contact_id UUID NOT NULL,
  lead_id UUID REFERENCES leads(lead_id) ON DELETE SET NULL,
  channel VARCHAR(30) NOT NULL,
  external_thread_id VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT communication_threads_company_project_fk
    FOREIGN KEY (company_id, project_id)
    REFERENCES projects(company_id, project_id) ON DELETE CASCADE,
  CONSTRAINT communication_threads_company_contact_fk
    FOREIGN KEY (company_id, contact_id)
    REFERENCES contacts(company_id, contact_id) ON DELETE CASCADE,
  CONSTRAINT communication_threads_channel_check
    CHECK (channel IN ('whatsapp', 'sms', 'email', 'chat', 'other')),
  CONSTRAINT communication_threads_status_check
    CHECK (status IN ('active', 'closed', 'archived')),
  CONSTRAINT communication_threads_external_not_blank
    CHECK (BTRIM(external_thread_id) <> ''),
  CONSTRAINT communication_threads_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (company_id, channel, external_thread_id),
  UNIQUE (company_id, thread_id)
);

CREATE INDEX IF NOT EXISTS communication_threads_lead_idx
  ON communication_threads (lead_id, updated_at DESC)
  WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS communication_threads_contact_idx
  ON communication_threads (contact_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS communication_threads_project_idx
  ON communication_threads (project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS communication_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  thread_id UUID NOT NULL,
  external_message_id VARCHAR(255) NOT NULL,
  direction VARCHAR(20) NOT NULL,
  message_type VARCHAR(40) NOT NULL DEFAULT 'text',
  body TEXT,
  button_id VARCHAR(255),
  occurred_at TIMESTAMPTZ NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT communication_messages_company_project_fk
    FOREIGN KEY (company_id, project_id)
    REFERENCES projects(company_id, project_id) ON DELETE CASCADE,
  CONSTRAINT communication_messages_company_thread_fk
    FOREIGN KEY (company_id, thread_id)
    REFERENCES communication_threads(company_id, thread_id) ON DELETE CASCADE,
  CONSTRAINT communication_messages_direction_check
    CHECK (direction IN ('inbound', 'outbound', 'system')),
  CONSTRAINT communication_messages_type_not_blank
    CHECK (BTRIM(message_type) <> ''),
  CONSTRAINT communication_messages_external_not_blank
    CHECK (BTRIM(external_message_id) <> ''),
  CONSTRAINT communication_messages_payload_object
    CHECK (jsonb_typeof(raw_payload) = 'object'),
  UNIQUE (company_id, thread_id, external_message_id)
);

CREATE INDEX IF NOT EXISTS communication_messages_thread_time_idx
  ON communication_messages (thread_id, occurred_at, message_id);
CREATE INDEX IF NOT EXISTS communication_messages_project_time_idx
  ON communication_messages (project_id, occurred_at DESC, message_id DESC);

CREATE TABLE IF NOT EXISTS legacy_import_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  source_system VARCHAR(80) NOT NULL,
  source_archive_sha256 VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  stats JSONB NOT NULL DEFAULT '{}'::JSONB,
  error_summary JSONB NOT NULL DEFAULT '[]'::JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT legacy_import_runs_company_project_fk
    FOREIGN KEY (company_id, project_id)
    REFERENCES projects(company_id, project_id) ON DELETE CASCADE,
  CONSTRAINT legacy_import_runs_source_not_blank
    CHECK (BTRIM(source_system) <> ''),
  CONSTRAINT legacy_import_runs_sha_check
    CHECK (source_archive_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT legacy_import_runs_status_check
    CHECK (status IN ('running', 'completed', 'failed', 'rolled_back')),
  CONSTRAINT legacy_import_runs_stats_object
    CHECK (jsonb_typeof(stats) = 'object'),
  CONSTRAINT legacy_import_runs_errors_array
    CHECK (jsonb_typeof(error_summary) = 'array')
);

CREATE INDEX IF NOT EXISTS legacy_import_runs_company_time_idx
  ON legacy_import_runs (company_id, started_at DESC, run_id DESC);

CREATE TABLE IF NOT EXISTS legacy_entity_mappings (
  mapping_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES legacy_import_runs(run_id) ON DELETE CASCADE,
  source_system VARCHAR(80) NOT NULL,
  source_collection VARCHAR(120) NOT NULL,
  source_id VARCHAR(255) NOT NULL,
  target_table VARCHAR(120) NOT NULL,
  target_id UUID NOT NULL,
  source_checksum VARCHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT legacy_entity_mappings_source_not_blank CHECK (
    BTRIM(source_system) <> ''
    AND BTRIM(source_collection) <> ''
    AND BTRIM(source_id) <> ''
    AND BTRIM(target_table) <> ''
  ),
  CONSTRAINT legacy_entity_mappings_checksum_check
    CHECK (source_checksum IS NULL OR source_checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT legacy_entity_mappings_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (
    company_id,
    source_system,
    source_collection,
    source_id,
    target_table
  )
);

CREATE INDEX IF NOT EXISTS legacy_entity_mappings_target_idx
  ON legacy_entity_mappings (company_id, target_table, target_id);
CREATE INDEX IF NOT EXISTS legacy_entity_mappings_run_idx
  ON legacy_entity_mappings (run_id, source_collection);

ALTER TABLE communication_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE communication_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE legacy_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_import_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE legacy_entity_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_entity_mappings FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  target RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sthyra_app_server')
     AND TO_REGPROCEDURE('private.is_company_member(integer)') IS NOT NULL
     AND TO_REGPROCEDURE('private.can_access_project(integer)') IS NOT NULL
     AND TO_REGPROCEDURE('private.is_trusted_app_request()') IS NOT NULL THEN
    FOR target IN
      SELECT * FROM (VALUES
        ('communication_threads',
          'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
        ('communication_messages',
          'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
        ('legacy_import_runs',
          'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
        ('legacy_entity_mappings',
          'private.is_company_member(company_id)')
      ) AS policies(table_name, expression)
    LOOP
      EXECUTE FORMAT(
        'DROP POLICY IF EXISTS tenant_select ON public.%I',
        target.table_name
      );
      EXECUTE FORMAT(
        'DROP POLICY IF EXISTS tenant_server_write ON public.%I',
        target.table_name
      );
      EXECUTE FORMAT(
        'CREATE POLICY tenant_select ON public.%I FOR SELECT TO sthyra_app_server USING (%s)',
        target.table_name,
        target.expression
      );
      EXECUTE FORMAT(
        'CREATE POLICY tenant_server_write ON public.%I FOR ALL TO sthyra_app_server USING ((%s) AND private.is_trusted_app_request()) WITH CHECK ((%s) AND private.is_trusted_app_request())',
        target.table_name,
        target.expression,
        target.expression
      );
    END LOOP;

    GRANT SELECT, INSERT, UPDATE, DELETE ON
      communication_threads,
      communication_messages,
      legacy_import_runs,
      legacy_entity_mappings
    TO sthyra_app_server;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT ALL ON
      communication_threads,
      communication_messages,
      legacy_import_runs,
      legacy_entity_mappings
    TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON
      communication_threads,
      communication_messages,
      legacy_import_runs,
      legacy_entity_mappings
    FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON
      communication_threads,
      communication_messages,
      legacy_import_runs,
      legacy_entity_mappings
    FROM authenticated;
  END IF;
END;
$$;

COMMIT;
