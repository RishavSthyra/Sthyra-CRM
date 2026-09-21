ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS merged_into_contact_id UUID
    REFERENCES contacts(contact_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS contacts_merged_into_idx
  ON contacts (merged_into_contact_id)
  WHERE merged_into_contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS contact_merge_history (
  merge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_contact_id UUID NOT NULL REFERENCES contacts(contact_id) ON DELETE RESTRICT,
  duplicate_contact_id UUID NOT NULL REFERENCES contacts(contact_id) ON DELETE RESTRICT,
  survivor_before JSONB NOT NULL,
  duplicate_before JSONB NOT NULL,
  applied_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  merged_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unmerged_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  unmerged_at TIMESTAMPTZ,
  unmerge_notes TEXT,

  CONSTRAINT contact_merge_different_contacts
    CHECK (survivor_contact_id <> duplicate_contact_id),
  CONSTRAINT contact_merge_snapshots_are_objects
    CHECK (
      jsonb_typeof(survivor_before) = 'object'
      AND jsonb_typeof(duplicate_before) = 'object'
      AND jsonb_typeof(applied_fields) = 'object'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS contact_merge_one_active_duplicate_idx
  ON contact_merge_history (duplicate_contact_id)
  WHERE unmerged_at IS NULL;

CREATE INDEX IF NOT EXISTS contact_merge_survivor_time_idx
  ON contact_merge_history (survivor_contact_id, merged_at DESC);

ALTER TABLE contact_aliases
  ADD COLUMN IF NOT EXISTS merge_id UUID
    REFERENCES contact_merge_history(merge_id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS contact_duplicate_exclusions (
  exclusion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id_low UUID NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
  contact_id_high UUID NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
  reason TEXT,
  marked_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT contact_duplicate_exclusion_order
    CHECK (contact_id_low::text < contact_id_high::text),
  CONSTRAINT contact_duplicate_exclusion_unique_pair
    UNIQUE (contact_id_low, contact_id_high)
);

CREATE TABLE IF NOT EXISTS contact_relationships (
  relationship_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
  related_contact_id UUID NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
  relationship_type VARCHAR(50) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT contact_relationship_different_contacts
    CHECK (contact_id <> related_contact_id),
  CONSTRAINT contact_relationship_type_not_blank
    CHECK (BTRIM(relationship_type) <> ''),
  CONSTRAINT contact_relationship_unique
    UNIQUE (contact_id, related_contact_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS contact_relationship_related_idx
  ON contact_relationships (related_contact_id, relationship_type);

CREATE TABLE IF NOT EXISTS contact_consents (
  consent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
  consent_type VARCHAR(50) NOT NULL,
  channel VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'granted',
  legal_basis VARCHAR(100),
  source VARCHAR(100),
  notes TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT contact_consent_type_not_blank CHECK (BTRIM(consent_type) <> ''),
  CONSTRAINT contact_consent_channel_check
    CHECK (channel IN ('email', 'sms', 'phone', 'whatsapp', 'push')),
  CONSTRAINT contact_consent_status_check
    CHECK (status IN ('granted', 'withdrawn')),
  CONSTRAINT contact_consent_expiry_check
    CHECK (expires_at IS NULL OR expires_at > granted_at),
  CONSTRAINT contact_consent_withdrawal_check
    CHECK (
      (status = 'granted' AND withdrawn_at IS NULL)
      OR (status = 'withdrawn' AND withdrawn_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS contact_consent_one_active_grant_idx
  ON contact_consents (contact_id, consent_type, channel)
  WHERE status = 'granted';

CREATE INDEX IF NOT EXISTS contact_consent_contact_time_idx
  ON contact_consents (contact_id, created_at DESC);
