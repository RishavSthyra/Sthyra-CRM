CREATE TABLE IF NOT EXISTS accounts (
  account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  account_type VARCHAR(50) NOT NULL,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT accounts_name_not_blank CHECK (BTRIM(name) <> ''),
  CONSTRAINT accounts_type_not_blank CHECK (BTRIM(account_type) <> '')
);

CREATE INDEX IF NOT EXISTS accounts_active_name_idx
  ON accounts (LOWER(name), account_id)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS contacts (
  contact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(account_id) ON DELETE SET NULL,
  first_name VARCHAR(200) NOT NULL,
  last_name VARCHAR(200),
  phone_number VARCHAR(20),
  alternate_phone_number VARCHAR(20),
  email VARCHAR(255),
  date_of_birth DATE,
  is_nri BOOLEAN NOT NULL DEFAULT FALSE,
  country VARCHAR(100),
  company_works_at VARCHAR(200),
  is_married BOOLEAN NOT NULL DEFAULT FALSE,
  anniversary_date DATE,
  address TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT contacts_first_name_not_blank CHECK (BTRIM(first_name) <> ''),
  CONSTRAINT contacts_contact_method_check
    CHECK (phone_number IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS contacts_active_account_idx
  ON contacts (account_id, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS contacts_active_name_idx
  ON contacts (LOWER(first_name), LOWER(last_name), contact_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS contacts_active_email_idx
  ON contacts (LOWER(email))
  WHERE archived_at IS NULL AND email IS NOT NULL;

CREATE INDEX IF NOT EXISTS contacts_active_phone_idx
  ON contacts (phone_number)
  WHERE archived_at IS NULL AND phone_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS contact_aliases (
  alias_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
  alias_type VARCHAR(30) NOT NULL,
  alias_value VARCHAR(500) NOT NULL,
  normalized_value VARCHAR(500) NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'profile_update',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT contact_aliases_type_check
    CHECK (alias_type IN ('name', 'email', 'phone', 'alternate_phone')),
  CONSTRAINT contact_aliases_value_not_blank CHECK (BTRIM(alias_value) <> ''),
  CONSTRAINT contact_aliases_unique_value
    UNIQUE (contact_id, alias_type, normalized_value)
);

CREATE INDEX IF NOT EXISTS contact_aliases_lookup_idx
  ON contact_aliases (alias_type, normalized_value);

CREATE TABLE IF NOT EXISTS contact_timeline_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT contact_timeline_event_type_not_blank CHECK (BTRIM(event_type) <> ''),
  CONSTRAINT contact_timeline_title_not_blank CHECK (BTRIM(title) <> ''),
  CONSTRAINT contact_timeline_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS contact_timeline_contact_time_idx
  ON contact_timeline_events (contact_id, occurred_at DESC, event_id DESC);
