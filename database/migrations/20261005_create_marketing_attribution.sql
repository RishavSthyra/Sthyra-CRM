BEGIN;

-- Composite foreign keys keep tenant-owned references inside the same company.
-- These indexes are also created by the Supabase multitenancy foundation, but
-- defining them here makes this migration safe when that foundation was run
-- before the indexes were added or was only partially applied.
CREATE UNIQUE INDEX IF NOT EXISTS projects_company_id_uidx
  ON projects (company_id, project_id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_company_id_uidx
  ON contacts (company_id, contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS lead_sources_company_id_uidx
  ON lead_sources (company_id, source_id);
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_company_id_uidx
  ON campaigns (company_id, campaign_id);

CREATE TABLE IF NOT EXISTS marketing_integrations (
  integration_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  provider VARCHAR(40) NOT NULL,
  integration_name VARCHAR(160) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  external_account_id VARCHAR(150),
  login_account_id VARCHAR(150),
  access_token_ciphertext TEXT,
  refresh_token_ciphertext TEXT,
  access_token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT marketing_integrations_provider_check CHECK (
    provider IN (
      'google_data_manager',
      'google_lead_form',
      'website_form',
      'generic_webhook',
      'channel_partner',
      'property_portal'
    )
  ),
  CONSTRAINT marketing_integrations_status_check CHECK (
    status IN ('draft', 'connected', 'error', 'disabled')
  ),
  CONSTRAINT marketing_integrations_name_not_blank
    CHECK (BTRIM(integration_name) <> ''),
  CONSTRAINT marketing_integrations_settings_object
    CHECK (jsonb_typeof(settings) = 'object'),
  UNIQUE (company_id, integration_name),
  UNIQUE (company_id, integration_id)
);

CREATE INDEX IF NOT EXISTS marketing_integrations_company_provider_idx
  ON marketing_integrations (company_id, provider, status, created_at DESC);

CREATE TABLE IF NOT EXISTS marketing_forms (
  form_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  integration_id UUID,
  source_id UUID,
  campaign_id UUID,
  form_name VARCHAR(180) NOT NULL,
  provider VARCHAR(40) NOT NULL DEFAULT 'website_form',
  public_key UUID NOT NULL DEFAULT gen_random_uuid(),
  provider_form_id VARCHAR(200),
  submission_secret_hash VARCHAR(64),
  webhook_secret_hash VARCHAR(64),
  allowed_origins TEXT[] NOT NULL DEFAULT '{}',
  field_mapping JSONB NOT NULL DEFAULT '{}'::JSONB,
  lead_defaults JSONB NOT NULL DEFAULT '{}'::JSONB,
  consent_notice TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT marketing_forms_company_project_fk
    FOREIGN KEY (company_id, project_id)
    REFERENCES projects(company_id, project_id) ON DELETE CASCADE,
  CONSTRAINT marketing_forms_company_integration_fk
    FOREIGN KEY (company_id, integration_id)
    REFERENCES marketing_integrations(company_id, integration_id)
    ON DELETE SET NULL (integration_id),
  CONSTRAINT marketing_forms_company_source_fk
    FOREIGN KEY (company_id, source_id)
    REFERENCES lead_sources(company_id, source_id) ON DELETE SET NULL (source_id),
  CONSTRAINT marketing_forms_company_campaign_fk
    FOREIGN KEY (company_id, campaign_id)
    REFERENCES campaigns(company_id, campaign_id) ON DELETE SET NULL (campaign_id),
  CONSTRAINT marketing_forms_provider_check CHECK (
    provider IN (
      'google_lead_form',
      'website_form',
      'generic_webhook',
      'channel_partner',
      'property_portal'
    )
  ),
  CONSTRAINT marketing_forms_name_not_blank CHECK (BTRIM(form_name) <> ''),
  CONSTRAINT marketing_forms_field_mapping_object
    CHECK (jsonb_typeof(field_mapping) = 'object'),
  CONSTRAINT marketing_forms_lead_defaults_object
    CHECK (jsonb_typeof(lead_defaults) = 'object'),
  UNIQUE (public_key),
  UNIQUE (company_id, form_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_forms_provider_form_uidx
  ON marketing_forms (company_id, provider, provider_form_id)
  WHERE provider_form_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketing_forms_company_project_idx
  ON marketing_forms (company_id, project_id, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS marketing_touchpoints (
  touchpoint_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  integration_id UUID,
  form_id UUID,
  contact_id UUID,
  lead_id UUID REFERENCES leads(lead_id) ON DELETE SET NULL,
  source_id UUID,
  campaign_id UUID,
  anonymous_visitor_id VARCHAR(200),
  session_id VARCHAR(200),
  event_type VARCHAR(50) NOT NULL,
  channel VARCHAR(80),
  medium VARCHAR(120),
  provider VARCHAR(40) NOT NULL,
  provider_event_id VARCHAR(220),
  idempotency_key VARCHAR(220) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  utm_source VARCHAR(300),
  utm_medium VARCHAR(300),
  utm_campaign VARCHAR(300),
  utm_term VARCHAR(500),
  utm_content VARCHAR(500),
  gclid VARCHAR(500),
  gbraid VARCHAR(500),
  wbraid VARCHAR(500),
  fbclid VARCHAR(500),
  external_campaign_id VARCHAR(200),
  external_ad_group_id VARCHAR(200),
  external_creative_id VARCHAR(200),
  external_form_id VARCHAR(200),
  landing_page_url TEXT,
  referrer_url TEXT,
  ad_user_data_consent VARCHAR(20),
  ad_personalization_consent VARCHAR(20),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT marketing_touchpoints_company_project_fk
    FOREIGN KEY (company_id, project_id)
    REFERENCES projects(company_id, project_id) ON DELETE CASCADE,
  CONSTRAINT marketing_touchpoints_company_integration_fk
    FOREIGN KEY (company_id, integration_id)
    REFERENCES marketing_integrations(company_id, integration_id)
    ON DELETE SET NULL (integration_id),
  CONSTRAINT marketing_touchpoints_company_form_fk
    FOREIGN KEY (company_id, form_id)
    REFERENCES marketing_forms(company_id, form_id)
    ON DELETE SET NULL (form_id),
  CONSTRAINT marketing_touchpoints_company_contact_fk
    FOREIGN KEY (company_id, contact_id)
    REFERENCES contacts(company_id, contact_id) ON DELETE SET NULL (contact_id),
  CONSTRAINT marketing_touchpoints_company_source_fk
    FOREIGN KEY (company_id, source_id)
    REFERENCES lead_sources(company_id, source_id) ON DELETE SET NULL (source_id),
  CONSTRAINT marketing_touchpoints_company_campaign_fk
    FOREIGN KEY (company_id, campaign_id)
    REFERENCES campaigns(company_id, campaign_id) ON DELETE SET NULL (campaign_id),
  CONSTRAINT marketing_touchpoints_event_type_not_blank
    CHECK (BTRIM(event_type) <> ''),
  CONSTRAINT marketing_touchpoints_provider_check CHECK (
    provider IN (
      'google_ads',
      'google_lead_form',
      'website_form',
      'generic_webhook',
      'channel_partner',
      'property_portal',
      'manual'
    )
  ),
  CONSTRAINT marketing_touchpoints_consent_check CHECK (
    (ad_user_data_consent IS NULL OR ad_user_data_consent IN ('granted', 'denied', 'unknown'))
    AND
    (ad_personalization_consent IS NULL OR ad_personalization_consent IN ('granted', 'denied', 'unknown'))
  ),
  CONSTRAINT marketing_touchpoints_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (company_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_touchpoints_provider_event_uidx
  ON marketing_touchpoints (company_id, provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketing_touchpoints_company_time_idx
  ON marketing_touchpoints (company_id, occurred_at DESC, touchpoint_id DESC);
CREATE INDEX IF NOT EXISTS marketing_touchpoints_project_time_idx
  ON marketing_touchpoints (project_id, occurred_at DESC, touchpoint_id DESC);
CREATE INDEX IF NOT EXISTS marketing_touchpoints_visitor_idx
  ON marketing_touchpoints (company_id, anonymous_visitor_id, occurred_at DESC)
  WHERE anonymous_visitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketing_touchpoints_lead_idx
  ON marketing_touchpoints (lead_id, occurred_at DESC)
  WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketing_touchpoints_click_idx
  ON marketing_touchpoints (company_id, gclid, occurred_at DESC)
  WHERE gclid IS NOT NULL;

CREATE TABLE IF NOT EXISTS marketing_conversion_jobs (
  conversion_job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  integration_id UUID NOT NULL,
  touchpoint_id UUID REFERENCES marketing_touchpoints(touchpoint_id) ON DELETE SET NULL,
  contact_id UUID,
  lead_id UUID REFERENCES leads(lead_id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES opportunities(opportunity_id) ON DELETE SET NULL,
  event_name VARCHAR(80) NOT NULL,
  transaction_id VARCHAR(220) NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  conversion_value NUMERIC(16,2),
  currency VARCHAR(3),
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 8,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  provider_response JSONB NOT NULL DEFAULT '{}'::JSONB,
  provider_request_id VARCHAR(220),
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT marketing_conversion_jobs_company_project_fk
    FOREIGN KEY (company_id, project_id)
    REFERENCES projects(company_id, project_id) ON DELETE CASCADE,
  CONSTRAINT marketing_conversion_jobs_company_integration_fk
    FOREIGN KEY (company_id, integration_id)
    REFERENCES marketing_integrations(company_id, integration_id) ON DELETE CASCADE,
  CONSTRAINT marketing_conversion_jobs_company_contact_fk
    FOREIGN KEY (company_id, contact_id)
    REFERENCES contacts(company_id, contact_id) ON DELETE SET NULL (contact_id),
  CONSTRAINT marketing_conversion_jobs_status_check CHECK (
    status IN ('queued', 'processing', 'sent', 'failed', 'discarded')
  ),
  CONSTRAINT marketing_conversion_jobs_value_check
    CHECK (conversion_value IS NULL OR conversion_value >= 0),
  CONSTRAINT marketing_conversion_jobs_currency_check
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CONSTRAINT marketing_conversion_jobs_attempt_check
    CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 20),
  CONSTRAINT marketing_conversion_jobs_request_object
    CHECK (jsonb_typeof(request_payload) = 'object'),
  CONSTRAINT marketing_conversion_jobs_response_object
    CHECK (jsonb_typeof(provider_response) = 'object'),
  UNIQUE (integration_id, event_name, transaction_id)
);

CREATE INDEX IF NOT EXISTS marketing_conversion_jobs_queue_idx
  ON marketing_conversion_jobs (status, next_attempt_at, created_at)
  WHERE status IN ('queued', 'failed');
CREATE INDEX IF NOT EXISTS marketing_conversion_jobs_company_time_idx
  ON marketing_conversion_jobs (company_id, created_at DESC);

-- A PostgreSQL-backed limiter works consistently across Vercel instances.
-- subject_hash is a keyed digest; raw visitor IP addresses are never stored.
CREATE TABLE IF NOT EXISTS marketing_ingestion_limits (
  form_id UUID NOT NULL REFERENCES marketing_forms(form_id) ON DELETE CASCADE,
  subject_hash VARCHAR(64) NOT NULL,
  action VARCHAR(20) NOT NULL,
  bucket_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (form_id, subject_hash, action, bucket_started_at),
  CONSTRAINT marketing_ingestion_limits_action_check
    CHECK (action IN ('track', 'submit', 'webhook')),
  CONSTRAINT marketing_ingestion_limits_count_check CHECK (request_count > 0)
);

ALTER TABLE marketing_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_integrations FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_forms FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_touchpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_touchpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_conversion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_conversion_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ingestion_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ingestion_limits FORCE ROW LEVEL SECURITY;

-- Supabase installs the trusted application role and private tenant helpers in
-- 20261003_supabase_multitenancy_foundation.sql. A standalone local PostgreSQL
-- database does not have those objects, so keep RLS fail-closed there and only
-- install application policies when the complete foundation is available.
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
        ('marketing_integrations',
          'private.is_company_member(company_id)'),
        ('marketing_forms',
          'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
        ('marketing_touchpoints',
          'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
        ('marketing_conversion_jobs',
          'private.is_company_member(company_id) AND private.can_access_project(project_id)')
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
      marketing_integrations,
      marketing_forms,
      marketing_touchpoints,
      marketing_conversion_jobs
    TO sthyra_app_server;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT ALL ON
      marketing_integrations,
      marketing_forms,
      marketing_touchpoints,
      marketing_conversion_jobs,
      marketing_ingestion_limits
    TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON
      marketing_integrations,
      marketing_forms,
      marketing_touchpoints,
      marketing_conversion_jobs,
      marketing_ingestion_limits
    FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON
      marketing_integrations,
      marketing_forms,
      marketing_touchpoints,
      marketing_conversion_jobs,
      marketing_ingestion_limits
    FROM authenticated;
  END IF;
END;
$$;

COMMIT;
