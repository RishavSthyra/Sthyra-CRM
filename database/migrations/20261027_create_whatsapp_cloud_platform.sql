BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp_connections (
  whatsapp_connection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  meta_business_id VARCHAR(100),
  waba_id VARCHAR(100) NOT NULL,
  phone_number_id VARCHAR(100) NOT NULL,
  display_phone_number VARCHAR(40),
  verified_name VARCHAR(255),
  quality_rating VARCHAR(40),
  access_token_ciphertext TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'connected',
  last_webhook_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT whatsapp_connections_status_check
    CHECK (status IN ('connected', 'reauthorization_required', 'disconnected', 'error')),
  CONSTRAINT whatsapp_connections_phone_unique UNIQUE (company_id, phone_number_id),
  CONSTRAINT whatsapp_connections_project_unique UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS whatsapp_connections_company_status_idx
  ON whatsapp_connections (company_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  whatsapp_template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_connection_id UUID NOT NULL REFERENCES whatsapp_connections(whatsapp_connection_id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  meta_template_id VARCHAR(100),
  name VARCHAR(512) NOT NULL,
  language VARCHAR(35) NOT NULL,
  category VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  components JSONB NOT NULL DEFAULT '[]'::jsonb,
  rejection_reason TEXT,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT whatsapp_templates_name_check CHECK (name ~ '^[a-z0-9_]+$'),
  CONSTRAINT whatsapp_templates_category_check CHECK (category IN ('AUTHENTICATION', 'MARKETING', 'UTILITY')),
  CONSTRAINT whatsapp_templates_components_check CHECK (jsonb_typeof(components) = 'array'),
  CONSTRAINT whatsapp_templates_unique UNIQUE (whatsapp_connection_id, name, language)
);

CREATE INDEX IF NOT EXISTS whatsapp_templates_project_status_idx
  ON whatsapp_templates (project_id, status, name);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  whatsapp_message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_connection_id UUID NOT NULL REFERENCES whatsapp_connections(whatsapp_connection_id) ON DELETE RESTRICT,
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(lead_id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(contact_id) ON DELETE SET NULL,
  owner_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  direction VARCHAR(12) NOT NULL,
  message_type VARCHAR(30) NOT NULL DEFAULT 'text',
  status VARCHAR(30) NOT NULL,
  recipient_phone VARCHAR(30) NOT NULL,
  body TEXT,
  whatsapp_template_id UUID REFERENCES whatsapp_templates(whatsapp_template_id) ON DELETE SET NULL,
  template_name VARCHAR(512),
  template_language VARCHAR(35),
  template_parameters JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_message_id VARCHAR(255),
  provider_conversation_id VARCHAR(255),
  provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reply_to_provider_message_id VARCHAR(255),
  error_code VARCHAR(100),
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT whatsapp_messages_direction_check CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT whatsapp_messages_type_check CHECK (message_type IN ('text', 'template', 'image', 'document', 'audio', 'video', 'location', 'contacts', 'interactive', 'unknown')),
  CONSTRAINT whatsapp_messages_status_check CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'received', 'failed', 'cancelled')),
  CONSTRAINT whatsapp_messages_parameters_check CHECK (jsonb_typeof(template_parameters) = 'array'),
  CONSTRAINT whatsapp_messages_payload_check CHECK (jsonb_typeof(provider_payload) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_provider_unique_idx
  ON whatsapp_messages (whatsapp_connection_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_messages_project_time_idx
  ON whatsapp_messages (project_id, COALESCE(received_at, sent_at, created_at) DESC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_contact_time_idx
  ON whatsapp_messages (contact_id, COALESCE(received_at, sent_at, created_at) DESC)
  WHERE contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS whatsapp_automation_rules (
  whatsapp_automation_rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_connection_id UUID NOT NULL REFERENCES whatsapp_connections(whatsapp_connection_id) ON DELETE CASCADE,
  whatsapp_template_id UUID NOT NULL REFERENCES whatsapp_templates(whatsapp_template_id) ON DELETE RESTRICT,
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  trigger_activity_type VARCHAR(100) NOT NULL,
  template_parameters JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT whatsapp_automation_name_check CHECK (BTRIM(name) <> ''),
  CONSTRAINT whatsapp_automation_trigger_check CHECK (BTRIM(trigger_activity_type) <> ''),
  CONSTRAINT whatsapp_automation_parameters_check CHECK (jsonb_typeof(template_parameters) = 'array')
);

CREATE INDEX IF NOT EXISTS whatsapp_automation_active_trigger_idx
  ON whatsapp_automation_rules (project_id, trigger_activity_type)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS whatsapp_delivery_jobs (
  whatsapp_delivery_job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_message_id UUID UNIQUE REFERENCES whatsapp_messages(whatsapp_message_id) ON DELETE CASCADE,
  whatsapp_automation_rule_id UUID REFERENCES whatsapp_automation_rules(whatsapp_automation_rule_id) ON DELETE CASCADE,
  activity_id UUID REFERENCES activities(activity_id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(lead_id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(contact_id) ON DELETE SET NULL,
  event_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT whatsapp_delivery_jobs_target_check CHECK (
    (whatsapp_message_id IS NOT NULL AND whatsapp_automation_rule_id IS NULL AND activity_id IS NULL)
    OR (whatsapp_automation_rule_id IS NOT NULL AND (activity_id IS NOT NULL OR contact_id IS NOT NULL))
  ),
  CONSTRAINT whatsapp_delivery_jobs_status_check CHECK (status IN ('queued', 'processing', 'retrying', 'sent', 'failed', 'cancelled')),
  CONSTRAINT whatsapp_delivery_jobs_attempts_check CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 20),
  CONSTRAINT whatsapp_delivery_jobs_automation_unique UNIQUE (whatsapp_automation_rule_id, activity_id)
);

CREATE INDEX IF NOT EXISTS whatsapp_delivery_jobs_ready_idx
  ON whatsapp_delivery_jobs (next_attempt_at, created_at)
  WHERE status IN ('queued', 'retrying');

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_source_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_source_type_check
  CHECK (source_type IN ('task', 'note', 'appointment', 'call', 'email', 'whatsapp'));

CREATE OR REPLACE FUNCTION queue_whatsapp_automation_jobs()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contact_id IS NULL OR NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO whatsapp_delivery_jobs (
    whatsapp_automation_rule_id, activity_id, lead_id, contact_id,
    company_id, project_id, event_context
  )
  SELECT rule.whatsapp_automation_rule_id, NEW.activity_id, NEW.lead_id, NEW.contact_id,
         NEW.company_id, NEW.project_id,
         JSONB_BUILD_OBJECT('activity_title',NEW.title,'activity_type',NEW.activity_type)
  FROM whatsapp_automation_rules rule
  JOIN whatsapp_templates template ON template.whatsapp_template_id=rule.whatsapp_template_id
  JOIN whatsapp_connections connection ON connection.whatsapp_connection_id=rule.whatsapp_connection_id
  WHERE rule.project_id=NEW.project_id
    AND rule.company_id=NEW.company_id
    AND rule.trigger_activity_type=NEW.activity_type
    AND rule.is_active=TRUE
    AND template.status='APPROVED'
    AND connection.status='connected'
  ON CONFLICT (whatsapp_automation_rule_id, activity_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS activities_queue_whatsapp_automation ON activities;
CREATE TRIGGER activities_queue_whatsapp_automation
AFTER INSERT ON activities
FOR EACH ROW EXECUTE FUNCTION queue_whatsapp_automation_jobs();

DO $$
DECLARE target RECORD;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('whatsapp_connections', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
    ('whatsapp_templates', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
    ('whatsapp_messages', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
    ('whatsapp_automation_rules', 'private.is_company_member(company_id) AND private.can_access_project(project_id)'),
    ('whatsapp_delivery_jobs', 'private.is_company_member(company_id) AND private.can_access_project(project_id)')
  ) AS policies(table_name, expression)
  LOOP
    EXECUTE FORMAT('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.table_name);
    EXECUTE FORMAT('CREATE POLICY tenant_select ON public.%I FOR SELECT TO sthyra_app_server USING (%s)', target.table_name, target.expression);
    EXECUTE FORMAT('CREATE POLICY tenant_server_write ON public.%I FOR ALL TO sthyra_app_server USING ((%s) AND private.is_trusted_app_request()) WITH CHECK ((%s) AND private.is_trusted_app_request())', target.table_name, target.expression, target.expression);
  END LOOP;
END;
$$;

COMMIT;
