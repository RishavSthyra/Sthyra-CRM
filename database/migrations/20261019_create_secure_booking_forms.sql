BEGIN;

CREATE TABLE IF NOT EXISTS booking_forms (
  booking_form_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_reference VARCHAR(80) NOT NULL UNIQUE,
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  quotation_id UUID NOT NULL REFERENCES opportunity_quotations(quotation_id) ON DELETE RESTRICT,
  unit_id UUID NOT NULL REFERENCES inventory_units(unit_id) ON DELETE RESTRICT,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  customer_name VARCHAR(250) NOT NULL,
  phone_number VARCHAR(40),
  configuration VARCHAR(250) NOT NULL,
  flat_number VARCHAR(200) NOT NULL,
  agreed_price NUMERIC(16,2) NOT NULL,
  booking_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  payment_plan JSONB NOT NULL DEFAULT '{}'::JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  first_viewed_at TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT booking_forms_status_check
    CHECK (status IN ('active','submitted','confirmed','expired','revoked')),
  CONSTRAINT booking_forms_name_not_blank CHECK (BTRIM(customer_name)<>''),
  CONSTRAINT booking_forms_configuration_not_blank CHECK (BTRIM(configuration)<>''),
  CONSTRAINT booking_forms_flat_number_not_blank CHECK (BTRIM(flat_number)<>''),
  CONSTRAINT booking_forms_amount_check
    CHECK (agreed_price>=0 AND booking_amount>=0 AND booking_amount<=agreed_price),
  CONSTRAINT booking_forms_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT booking_forms_payment_plan_check CHECK (jsonb_typeof(payment_plan)='object'),
  CONSTRAINT booking_forms_expiry_check CHECK (expires_at>created_at),
  CONSTRAINT booking_forms_view_count_check CHECK (view_count>=0),
  UNIQUE (quotation_id)
);

CREATE INDEX IF NOT EXISTS booking_forms_opportunity_idx
  ON booking_forms (opportunity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS booking_forms_project_status_idx
  ON booking_forms (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS booking_forms_active_token_idx
  ON booking_forms (token_hash, expires_at) WHERE status='active';

ALTER TABLE opportunity_quotation_events
  DROP CONSTRAINT IF EXISTS opportunity_quotation_event_type_check;
ALTER TABLE opportunity_quotation_events
  ADD CONSTRAINT opportunity_quotation_event_type_check
    CHECK (event_type IN (
      'created','updated','revised','sent','shared','viewed','accepted',
      'rejected','expired','cancelled','booking_created','agreement_ready',
      'booking_form_created','booking_form_viewed','booking_form_submitted',
      'booking_form_revoked'
    ));

ALTER TABLE booking_forms ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sthyra_app_server') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON booking_forms TO sthyra_app_server;
    IF TO_REGPROCEDURE('private.can_access_opportunity(uuid)') IS NOT NULL
       AND TO_REGPROCEDURE('private.is_trusted_app_request()') IS NOT NULL THEN
      DROP POLICY IF EXISTS tenant_select ON booking_forms;
      DROP POLICY IF EXISTS tenant_server_write ON booking_forms;
      CREATE POLICY tenant_select ON booking_forms
        FOR SELECT TO sthyra_app_server
        USING (private.can_access_opportunity(opportunity_id));
      CREATE POLICY tenant_server_write ON booking_forms
        FOR ALL TO sthyra_app_server
        USING (private.can_access_opportunity(opportunity_id) AND private.is_trusted_app_request())
        WITH CHECK (private.can_access_opportunity(opportunity_id) AND private.is_trusted_app_request());
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT ALL ON booking_forms TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON booking_forms FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON booking_forms FROM authenticated;
  END IF;
END;
$$;

DO $$
BEGIN
  IF TO_REGPROCEDURE('private.capture_tenant_audit_log()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_audit_log ON booking_forms;
    CREATE TRIGGER tenant_audit_log
      AFTER INSERT OR UPDATE OR DELETE ON booking_forms
      FOR EACH ROW EXECUTE FUNCTION private.capture_tenant_audit_log('booking_form_id');
  END IF;
END;
$$;

COMMIT;
