BEGIN;

-- The original invitation migration was expanded after some environments had
-- already applied it. Add the delivery and revocation audit columns again in a
-- forward-only migration so invitation listing, resend, and revoke operations
-- use the same schema everywhere.
ALTER TABLE workspace_invitations
  ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS send_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspace_invitations_send_count_check'
      AND conrelid = 'workspace_invitations'::regclass
  ) THEN
    ALTER TABLE workspace_invitations
      ADD CONSTRAINT workspace_invitations_send_count_check
      CHECK (send_count >= 0);
  END IF;
END;
$$;

COMMIT;
