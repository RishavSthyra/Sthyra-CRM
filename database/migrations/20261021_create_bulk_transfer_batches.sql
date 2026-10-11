BEGIN;

CREATE TABLE IF NOT EXISTS transfer_batches (
  batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  to_owner_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  to_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  checklist_template_id UUID REFERENCES transfer_checklist_templates(template_id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'submitted',
  reason TEXT NOT NULL,
  notes TEXT,
  expires_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  requested_count INTEGER NOT NULL,
  created_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  blocked_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transfer_batches_target_check
    CHECK ((to_owner_user_id IS NOT NULL)::integer + (to_team_id IS NOT NULL)::integer = 1),
  CONSTRAINT transfer_batches_status_check
    CHECK (status IN ('submitted','partially_accepted','accepted','rejected','cancelled','expired')),
  CONSTRAINT transfer_batches_reason_not_blank CHECK (BTRIM(reason) <> ''),
  CONSTRAINT transfer_batches_counts_check CHECK (
    requested_count >= 2 AND created_count >= 0 AND blocked_count >= 0
    AND created_count + blocked_count = requested_count
  ),
  CONSTRAINT transfer_batches_blocked_items_array
    CHECK (jsonb_typeof(blocked_items) = 'array')
);

CREATE INDEX IF NOT EXISTS transfer_batches_project_time_idx
  ON transfer_batches (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transfer_batches_recipient_status_idx
  ON transfer_batches (to_owner_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS transfer_batches_team_status_idx
  ON transfer_batches (to_team_id, status, created_at DESC);

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES transfer_batches(batch_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS transfers_batch_idx
  ON transfers (batch_id, created_at, transfer_id)
  WHERE batch_id IS NOT NULL;

ALTER TABLE transfer_batches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sthyra_app_server') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON transfer_batches TO sthyra_app_server;
    IF TO_REGPROCEDURE('private.can_access_transfer_values(integer,integer,uuid,uuid,uuid,uuid,uuid,timestamp with time zone)') IS NOT NULL
       AND TO_REGPROCEDURE('private.is_trusted_app_request()') IS NOT NULL THEN
      DROP POLICY IF EXISTS tenant_select ON transfer_batches;
      DROP POLICY IF EXISTS tenant_server_write ON transfer_batches;
      CREATE POLICY tenant_select ON transfer_batches FOR SELECT TO sthyra_app_server
        USING (private.can_access_transfer_values(
          company_id, project_id, requested_by, NULL, NULL,
          to_owner_user_id, to_team_id, submitted_at
        ));
      CREATE POLICY tenant_server_write ON transfer_batches FOR ALL TO sthyra_app_server
        USING (
          private.is_trusted_app_request()
          AND private.can_access_transfer_values(
            company_id, project_id, requested_by, NULL, NULL,
            to_owner_user_id, to_team_id, submitted_at
          )
        )
        WITH CHECK (
          private.is_trusted_app_request()
          AND private.can_access_transfer_values(
            company_id, project_id, requested_by, NULL, NULL,
            to_owner_user_id, to_team_id, submitted_at
          )
        );
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT ALL ON transfer_batches TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON transfer_batches FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON transfer_batches FROM authenticated;
  END IF;
END;
$$;

DO $$
BEGIN
  IF TO_REGPROCEDURE('private.capture_tenant_audit_log()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_audit_log ON transfer_batches;
    CREATE TRIGGER tenant_audit_log
      AFTER INSERT OR UPDATE OR DELETE ON transfer_batches
      FOR EACH ROW EXECUTE FUNCTION private.capture_tenant_audit_log('batch_id');
  END IF;
END;
$$;

COMMIT;
