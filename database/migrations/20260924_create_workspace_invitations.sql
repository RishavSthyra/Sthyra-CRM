BEGIN;

CREATE TABLE IF NOT EXISTS workspace_invitations (
  invitation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role_id UUID NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
  team_id UUID NOT NULL REFERENCES teams(team_id) ON DELETE RESTRICT,
  invited_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  send_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT workspace_invitations_email_not_blank CHECK (BTRIM(email) <> ''),
  CONSTRAINT workspace_invitations_email_lowercase CHECK (email = LOWER(email)),
  CONSTRAINT workspace_invitations_status_check
    CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  CONSTRAINT workspace_invitations_send_count_check CHECK (send_count >= 0)
);

-- Keep reruns safe if an earlier version of this migration created the table.
ALTER TABLE workspace_invitations
  ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS send_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_invitations_send_count_check'
  ) THEN
    ALTER TABLE workspace_invitations
      ADD CONSTRAINT workspace_invitations_send_count_check
      CHECK (send_count >= 0);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_pending_email_idx
  ON workspace_invitations (company_id, LOWER(email))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS workspace_invitations_company_status_idx
  ON workspace_invitations (company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS workspace_invitations_expiry_idx
  ON workspace_invitations (expires_at)
  WHERE status = 'pending';

COMMIT;