BEGIN;

CREATE TABLE IF NOT EXISTS auth_identities (
  auth_identity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider VARCHAR(30) NOT NULL,
  provider_subject VARCHAR(255) NOT NULL,
  provider_email VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_identities_provider_check CHECK (provider IN ('google', 'microsoft')),
  CONSTRAINT auth_identities_provider_subject_unique UNIQUE (provider, provider_subject),
  CONSTRAINT auth_identities_user_provider_unique UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS auth_identities_email_idx
  ON auth_identities (LOWER(provider_email));

CREATE TABLE IF NOT EXISTS email_connections (
  email_connection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider VARCHAR(30) NOT NULL,
  provider_account_id VARCHAR(255) NOT NULL,
  email_address VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  access_token_ciphertext TEXT,
  refresh_token_ciphertext TEXT,
  access_token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  status VARCHAR(40) NOT NULL DEFAULT 'connected',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  sync_cursor TEXT,
  watch_expires_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT email_connections_provider_check CHECK (provider IN ('google', 'microsoft')),
  CONSTRAINT email_connections_status_check
    CHECK (status IN ('connected', 'reauthorization_required', 'disconnected', 'error')),
  CONSTRAINT email_connections_email_not_blank CHECK (BTRIM(email_address) <> ''),
  CONSTRAINT email_connections_account_unique
    UNIQUE (company_id, provider, provider_account_id),
  CONSTRAINT email_connections_user_email_unique
    UNIQUE (user_id, provider, email_address)
);

CREATE UNIQUE INDEX IF NOT EXISTS email_connections_user_default_idx
  ON email_connections (user_id) WHERE is_default = TRUE AND status = 'connected';
CREATE INDEX IF NOT EXISTS email_connections_company_idx
  ON email_connections (company_id, status, email_address);

ALTER TABLE emails ADD COLUMN IF NOT EXISTS email_connection_id UUID
  REFERENCES email_connections(email_connection_id) ON DELETE SET NULL;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS provider VARCHAR(30);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(500);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS provider_thread_id VARCHAR(500);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS internet_message_id VARCHAR(1000);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS in_reply_to VARCHAR(1000);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS delivery_error TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;

ALTER TABLE emails DROP CONSTRAINT IF EXISTS emails_provider_check;
ALTER TABLE emails ADD CONSTRAINT emails_provider_check
  CHECK (provider IS NULL OR provider IN ('google', 'microsoft', 'smtp'));

ALTER TABLE emails DROP CONSTRAINT IF EXISTS emails_status_check;
ALTER TABLE emails ADD CONSTRAINT emails_status_check
  CHECK (status IN (
    'draft', 'scheduled', 'queued', 'sending', 'sent', 'delivered',
    'opened', 'replied', 'bounced', 'failed', 'cancelled', 'received'
  ));

CREATE INDEX IF NOT EXISTS emails_connection_time_idx
  ON emails (email_connection_id, COALESCE(sent_at, received_at, created_at) DESC)
  WHERE email_connection_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS emails_provider_message_unique_idx
  ON emails (email_connection_id, provider_message_id)
  WHERE email_connection_id IS NOT NULL AND provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_delivery_jobs (
  email_delivery_job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID NOT NULL UNIQUE REFERENCES emails(email_id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT email_delivery_jobs_status_check
    CHECK (status IN ('queued', 'processing', 'retrying', 'sent', 'failed', 'cancelled')),
  CONSTRAINT email_delivery_jobs_attempts_check
    CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 20)
);

CREATE INDEX IF NOT EXISTS email_delivery_jobs_ready_idx
  ON email_delivery_jobs (next_attempt_at, created_at)
  WHERE status IN ('queued', 'retrying');

COMMIT;
