BEGIN;

CREATE TABLE IF NOT EXISTS tasks (
  task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(lead_id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(contact_id) ON DELETE SET NULL,
  title VARCHAR(250) NOT NULL,
  description TEXT,
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  due_at TIMESTAMPTZ,
  assigned_to_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_to_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tasks_title_not_blank CHECK (BTRIM(title) <> ''),
  CONSTRAINT tasks_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT tasks_status_check CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS tasks_project_status_due_idx
  ON tasks (project_id, status, due_at, created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_user_status_due_idx
  ON tasks (assigned_to_user_id, status, due_at);
CREATE INDEX IF NOT EXISTS tasks_lead_time_idx
  ON tasks (lead_id, created_at DESC) WHERE lead_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notes (
  note_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(lead_id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(contact_id) ON DELETE SET NULL,
  title VARCHAR(250),
  body TEXT NOT NULL,
  visibility VARCHAR(20) NOT NULL DEFAULT 'team',
  owner_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notes_title_not_blank CHECK (title IS NULL OR BTRIM(title) <> ''),
  CONSTRAINT notes_body_not_blank CHECK (BTRIM(body) <> ''),
  CONSTRAINT notes_visibility_check CHECK (visibility IN ('private', 'team', 'company'))
);

CREATE INDEX IF NOT EXISTS notes_project_active_time_idx
  ON notes (project_id, is_pinned DESC, created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS notes_lead_time_idx
  ON notes (lead_id, created_at DESC) WHERE lead_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS appointments (
  appointment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(lead_id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(contact_id) ON DELETE SET NULL,
  appointment_type VARCHAR(30) NOT NULL DEFAULT 'meeting',
  title VARCHAR(250) NOT NULL,
  description TEXT,
  location VARCHAR(500),
  meeting_url VARCHAR(2000),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  organizer_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_to_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_to_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  cancellation_reason TEXT,
  reschedule_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT appointments_title_not_blank CHECK (BTRIM(title) <> ''),
  CONSTRAINT appointments_type_check
    CHECK (appointment_type IN ('call', 'meeting', 'site_visit', 'video', 'other')),
  CONSTRAINT appointments_status_check
    CHECK (status IN ('scheduled', 'confirmed', 'rescheduled', 'cancelled', 'completed')),
  CONSTRAINT appointments_time_check CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS appointments_project_status_time_idx
  ON appointments (project_id, status, starts_at);
CREATE INDEX IF NOT EXISTS appointments_user_status_time_idx
  ON appointments (assigned_to_user_id, status, starts_at);
CREATE INDEX IF NOT EXISTS appointments_lead_time_idx
  ON appointments (lead_id, starts_at DESC) WHERE lead_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS activities (
  activity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(lead_id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(contact_id) ON DELETE SET NULL,
  activity_type VARCHAR(50) NOT NULL,
  source_type VARCHAR(20) NOT NULL,
  source_id UUID NOT NULL,
  title VARCHAR(250) NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT activities_type_not_blank CHECK (BTRIM(activity_type) <> ''),
  CONSTRAINT activities_source_type_check CHECK (source_type IN ('task', 'note', 'appointment')),
  CONSTRAINT activities_title_not_blank CHECK (BTRIM(title) <> ''),
  CONSTRAINT activities_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS activities_project_timeline_idx
  ON activities (project_id, occurred_at DESC, activity_id DESC);
CREATE INDEX IF NOT EXISTS activities_lead_timeline_idx
  ON activities (lead_id, occurred_at DESC, activity_id DESC) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS activities_contact_timeline_idx
  ON activities (contact_id, occurred_at DESC, activity_id DESC) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS activities_source_idx
  ON activities (source_type, source_id, occurred_at DESC);

COMMIT;
