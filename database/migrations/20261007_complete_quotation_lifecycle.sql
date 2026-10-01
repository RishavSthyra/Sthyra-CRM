BEGIN;

-- Quotations are immutable commercial snapshots once accepted. Earlier V1
-- rows are backfilled with their tenant keys so they can participate in audit
-- logging and tenant-scoped RLS without joining through an opportunity.
ALTER TABLE opportunity_quotations
  ADD COLUMN IF NOT EXISTS company_id INTEGER,
  ADD COLUMN IF NOT EXISTS project_id INTEGER,
  ADD COLUMN IF NOT EXISTS parent_quotation_id UUID REFERENCES opportunity_quotations(quotation_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS title VARCHAR(250),
  ADD COLUMN IF NOT EXISTS charges_total NUMERIC(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(16,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_breakdown JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS payment_plan JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS terms_and_conditions TEXT,
  ADD COLUMN IF NOT EXISTS customer_message TEXT,
  ADD COLUMN IF NOT EXISTS revision_reason TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_by_name VARCHAR(250),
  ADD COLUMN IF NOT EXISTS accepted_by_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS acceptance_comment TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason VARCHAR(250),
  ADD COLUMN IF NOT EXISTS rejection_comment TEXT,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(user_id) ON DELETE SET NULL;

UPDATE opportunity_quotations quotation
SET company_id = opportunity.company_id,
    project_id = opportunity.project_id,
    title = COALESCE(quotation.title, 'Quotation ' || quotation.quotation_number)
FROM opportunities opportunity
WHERE opportunity.opportunity_id = quotation.opportunity_id
  AND (quotation.company_id IS NULL OR quotation.project_id IS NULL OR quotation.title IS NULL);

ALTER TABLE opportunity_quotations
  ALTER COLUMN company_id SET NOT NULL,
  ALTER COLUMN project_id SET NOT NULL,
  ALTER COLUMN title SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='opportunity_quotations_company_fk'
      AND conrelid='opportunity_quotations'::regclass
  ) THEN
    ALTER TABLE opportunity_quotations
      ADD CONSTRAINT opportunity_quotations_company_fk
      FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='opportunity_quotations_project_fk'
      AND conrelid='opportunity_quotations'::regclass
  ) THEN
    ALTER TABLE opportunity_quotations
      ADD CONSTRAINT opportunity_quotations_project_fk
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE;
  END IF;
END;
$$;

ALTER TABLE opportunity_quotations
  DROP CONSTRAINT IF EXISTS opportunity_quotation_status_check,
  DROP CONSTRAINT IF EXISTS opportunity_quotation_amount_check;

ALTER TABLE opportunity_quotations
  ADD CONSTRAINT opportunity_quotation_status_check
    CHECK (status IN ('draft','sent','viewed','accepted','rejected','expired','cancelled')),
  ADD CONSTRAINT opportunity_quotation_amount_check
    CHECK (
      subtotal >= 0 AND charges_total >= 0 AND discount_value >= 0
      AND discount_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0
    ),
  ADD CONSTRAINT opportunity_quotation_discount_type_check
    CHECK (discount_type IS NULL OR discount_type IN ('percentage','fixed')),
  ADD CONSTRAINT opportunity_quotation_tax_breakdown_check
    CHECK (jsonb_typeof(tax_breakdown)='array'),
  ADD CONSTRAINT opportunity_quotation_payment_plan_check
    CHECK (jsonb_typeof(payment_plan)='object'),
  ADD CONSTRAINT opportunity_quotation_view_count_check CHECK (view_count >= 0);

CREATE INDEX IF NOT EXISTS opportunity_quotations_company_project_idx
  ON opportunity_quotations (company_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS opportunity_quotations_revision_idx
  ON opportunity_quotations (opportunity_id, quotation_number, version DESC);

-- Older builds did not enforce this invariant. Preserve the newest accepted
-- commercial snapshot and close any older accepted rows before adding the
-- unique guard.
WITH ranked_accepted AS (
  SELECT quotation_id,
         ROW_NUMBER() OVER (
           PARTITION BY opportunity_id
           ORDER BY accepted_at DESC NULLS LAST, version DESC, created_at DESC
         ) AS accepted_rank
  FROM opportunity_quotations
  WHERE status='accepted'
)
UPDATE opportunity_quotations quotation
SET status='expired',
    expired_at=COALESCE(quotation.expired_at,CURRENT_TIMESTAMP),
    updated_at=CURRENT_TIMESTAMP
FROM ranked_accepted ranked
WHERE quotation.quotation_id=ranked.quotation_id
  AND ranked.accepted_rank>1;

CREATE UNIQUE INDEX IF NOT EXISTS opportunity_quotations_one_accepted_uidx
  ON opportunity_quotations (opportunity_id) WHERE status='accepted';

CREATE TABLE IF NOT EXISTS quotation_share_links (
  share_link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  quotation_id UUID NOT NULL REFERENCES opportunity_quotations(quotation_id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  recipient_email VARCHAR(255),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT quotation_share_link_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT quotation_share_link_view_count_check CHECK (view_count >= 0)
);
CREATE INDEX IF NOT EXISTS quotation_share_links_quote_idx
  ON quotation_share_links (quotation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quotation_share_links_active_idx
  ON quotation_share_links (token_hash, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS opportunity_quotation_events (
  quotation_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  quotation_id UUID NOT NULL REFERENCES opportunity_quotations(quotation_id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  actor_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  actor_name VARCHAR(250),
  actor_email VARCHAR(255),
  comment TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT opportunity_quotation_event_type_check
    CHECK (event_type IN (
      'created','updated','revised','sent','shared','viewed','accepted',
      'rejected','expired','cancelled','booking_created','agreement_ready'
    )),
  CONSTRAINT opportunity_quotation_event_metadata_check CHECK (jsonb_typeof(metadata)='object')
);
CREATE INDEX IF NOT EXISTS opportunity_quotation_events_quote_idx
  ON opportunity_quotation_events (quotation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS opportunity_quotation_events_opportunity_idx
  ON opportunity_quotation_events (opportunity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quotation_conversions (
  conversion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  quotation_id UUID NOT NULL REFERENCES opportunity_quotations(quotation_id) ON DELETE RESTRICT,
  target_type VARCHAR(20) NOT NULL,
  reservation_id UUID REFERENCES inventory_reservations(reservation_id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ready',
  snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  CONSTRAINT quotation_conversion_target_check CHECK (target_type IN ('booking','agreement')),
  CONSTRAINT quotation_conversion_status_check CHECK (status IN ('ready','completed','cancelled')),
  CONSTRAINT quotation_conversion_snapshot_check CHECK (jsonb_typeof(snapshot)='object'),
  UNIQUE (quotation_id, target_type)
);
CREATE INDEX IF NOT EXISTS quotation_conversions_opportunity_idx
  ON quotation_conversions (opportunity_id, created_at DESC);

ALTER TABLE quotation_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_quotation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_conversions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sthyra_app_server') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      quotation_share_links, opportunity_quotation_events, quotation_conversions
      TO sthyra_app_server;

    IF TO_REGPROCEDURE('private.can_access_opportunity(uuid)') IS NOT NULL
       AND TO_REGPROCEDURE('private.is_trusted_app_request()') IS NOT NULL THEN
      DROP POLICY IF EXISTS tenant_select ON quotation_share_links;
      DROP POLICY IF EXISTS tenant_server_write ON quotation_share_links;
      CREATE POLICY tenant_select ON quotation_share_links
        FOR SELECT TO sthyra_app_server
        USING (EXISTS (
          SELECT 1 FROM opportunity_quotations quotation
          WHERE quotation.quotation_id=quotation_share_links.quotation_id
            AND private.can_access_opportunity(quotation.opportunity_id)
        ));
      CREATE POLICY tenant_server_write ON quotation_share_links
        FOR ALL TO sthyra_app_server
        USING (
          private.is_trusted_app_request()
          AND EXISTS (
            SELECT 1 FROM opportunity_quotations quotation
            WHERE quotation.quotation_id=quotation_share_links.quotation_id
              AND private.can_access_opportunity(quotation.opportunity_id)
          )
        )
        WITH CHECK (
          private.is_trusted_app_request()
          AND EXISTS (
            SELECT 1 FROM opportunity_quotations quotation
            WHERE quotation.quotation_id=quotation_share_links.quotation_id
              AND private.can_access_opportunity(quotation.opportunity_id)
          )
        );

      DROP POLICY IF EXISTS tenant_select ON opportunity_quotation_events;
      DROP POLICY IF EXISTS tenant_server_write ON opportunity_quotation_events;
      CREATE POLICY tenant_select ON opportunity_quotation_events
        FOR SELECT TO sthyra_app_server USING (private.can_access_opportunity(opportunity_id));
      CREATE POLICY tenant_server_write ON opportunity_quotation_events
        FOR ALL TO sthyra_app_server
        USING (private.can_access_opportunity(opportunity_id) AND private.is_trusted_app_request())
        WITH CHECK (private.can_access_opportunity(opportunity_id) AND private.is_trusted_app_request());

      DROP POLICY IF EXISTS tenant_select ON quotation_conversions;
      DROP POLICY IF EXISTS tenant_server_write ON quotation_conversions;
      CREATE POLICY tenant_select ON quotation_conversions
        FOR SELECT TO sthyra_app_server USING (private.can_access_opportunity(opportunity_id));
      CREATE POLICY tenant_server_write ON quotation_conversions
        FOR ALL TO sthyra_app_server
        USING (private.can_access_opportunity(opportunity_id) AND private.is_trusted_app_request())
        WITH CHECK (private.can_access_opportunity(opportunity_id) AND private.is_trusted_app_request());
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT ALL ON quotation_share_links, opportunity_quotation_events, quotation_conversions TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON quotation_share_links, opportunity_quotation_events, quotation_conversions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON quotation_share_links, opportunity_quotation_events, quotation_conversions FROM authenticated;
  END IF;
END;
$$;

DO $$
BEGIN
  IF TO_REGPROCEDURE('private.capture_tenant_audit_log()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_audit_log ON opportunity_quotations;
    CREATE TRIGGER tenant_audit_log
      AFTER INSERT OR UPDATE OR DELETE ON opportunity_quotations
      FOR EACH ROW EXECUTE FUNCTION private.capture_tenant_audit_log('quotation_id');

    DROP TRIGGER IF EXISTS tenant_audit_log ON quotation_share_links;
    CREATE TRIGGER tenant_audit_log
      AFTER INSERT OR UPDATE OR DELETE ON quotation_share_links
      FOR EACH ROW EXECUTE FUNCTION private.capture_tenant_audit_log('share_link_id');

    DROP TRIGGER IF EXISTS tenant_audit_log ON quotation_conversions;
    CREATE TRIGGER tenant_audit_log
      AFTER INSERT OR UPDATE OR DELETE ON quotation_conversions
      FOR EACH ROW EXECUTE FUNCTION private.capture_tenant_audit_log('conversion_id');
  END IF;
END;
$$;

COMMIT;
