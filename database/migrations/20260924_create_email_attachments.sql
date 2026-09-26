BEGIN;

CREATE TABLE IF NOT EXISTS email_attachments (
  attachment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID NOT NULL REFERENCES emails(email_id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL,
  content BYTEA NOT NULL,
  uploaded_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT email_attachments_name_not_blank CHECK (BTRIM(file_name) <> ''),
  CONSTRAINT email_attachments_size_check CHECK (size_bytes BETWEEN 1 AND 10485760),
  CONSTRAINT email_attachments_content_size_check CHECK (OCTET_LENGTH(content) = size_bytes)
);

CREATE INDEX IF NOT EXISTS email_attachments_email_idx
  ON email_attachments (email_id, created_at, attachment_id);
CREATE INDEX IF NOT EXISTS email_attachments_project_idx
  ON email_attachments (project_id, created_at DESC);

COMMIT;
