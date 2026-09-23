BEGIN;

CREATE TABLE IF NOT EXISTS queues (
  queue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(project_id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  queue_code VARCHAR(50) NOT NULL,
  queue_name VARCHAR(150) NOT NULL,
  description TEXT,
  assignment_strategy VARCHAR(30) NOT NULL DEFAULT 'manual',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_assigned_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT queues_code_not_blank CHECK (BTRIM(queue_code) <> ''),
  CONSTRAINT queues_name_not_blank CHECK (BTRIM(queue_name) <> ''),
  CONSTRAINT queues_strategy_check
    CHECK (assignment_strategy IN ('manual', 'round_robin', 'load_balanced'))
);

CREATE UNIQUE INDEX IF NOT EXISTS queues_company_code_unique_idx
  ON queues (company_id, LOWER(queue_code));
CREATE INDEX IF NOT EXISTS queues_company_project_idx
  ON queues (company_id, project_id, is_active, queue_name);

CREATE TABLE IF NOT EXISTS queue_members (
  queue_id UUID NOT NULL REFERENCES queues(queue_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (queue_id, user_id),
  CONSTRAINT queue_members_position_check CHECK (position > 0)
);

CREATE INDEX IF NOT EXISTS queue_members_rotation_idx
  ON queue_members (queue_id, is_active, position, user_id);

CREATE TABLE IF NOT EXISTS assignments (
  assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  queue_id UUID REFERENCES queues(queue_id) ON DELETE SET NULL,
  assigned_to_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_to_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  assigned_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  rejection_reason TEXT,
  release_reason TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assignments_status_check
    CHECK (status IN ('pending', 'accepted', 'rejected', 'released', 'reassigned', 'cancelled', 'completed')),
  CONSTRAINT assignments_target_check
    CHECK (assigned_to_user_id IS NOT NULL OR assigned_to_team_id IS NOT NULL),
  CONSTRAINT assignments_priority_check CHECK (priority BETWEEN -1000 AND 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS assignments_one_current_per_lead_idx
  ON assignments (lead_id)
  WHERE status IN ('pending', 'accepted');
CREATE INDEX IF NOT EXISTS assignments_assignee_status_idx
  ON assignments (assigned_to_user_id, status, assigned_at DESC);
CREATE INDEX IF NOT EXISTS assignments_project_status_idx
  ON assignments (project_id, status, assigned_at DESC);
CREATE INDEX IF NOT EXISTS assignments_queue_status_idx
  ON assignments (queue_id, status, assigned_at DESC);

CREATE TABLE IF NOT EXISTS assignment_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES assignments(assignment_id) ON DELETE CASCADE,
  action VARCHAR(30) NOT NULL,
  from_status VARCHAR(20),
  to_status VARCHAR(20) NOT NULL,
  from_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  to_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  from_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  to_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  performed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assignment_history_action_check
    CHECK (action IN ('created', 'accepted', 'rejected', 'released', 'reassigned', 'claimed', 'auto_assigned', 'completed', 'cancelled')),
  CONSTRAINT assignment_history_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS assignment_history_assignment_time_idx
  ON assignment_history (assignment_id, created_at DESC, history_id DESC);

CREATE TABLE IF NOT EXISTS queue_records (
  queue_record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES queues(queue_id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  priority INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  assignment_id UUID REFERENCES assignments(assignment_id) ON DELETE SET NULL,
  added_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT queue_records_status_check
    CHECK (status IN ('waiting', 'claimed', 'assigned', 'removed')),
  CONSTRAINT queue_records_priority_check CHECK (priority BETWEEN -1000 AND 1000),
  CONSTRAINT queue_records_claim_check
    CHECK (
      (status = 'claimed' AND claimed_by IS NOT NULL AND claimed_at IS NOT NULL)
      OR status <> 'claimed'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS queue_records_one_waiting_lead_idx
  ON queue_records (lead_id) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS queue_records_next_idx
  ON queue_records (queue_id, status, priority DESC, available_at, created_at);

CREATE TABLE IF NOT EXISTS routing_rules (
  rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(project_id) ON DELETE CASCADE,
  rule_name VARCHAR(150) NOT NULL,
  description TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_type VARCHAR(20) NOT NULL,
  target_queue_id UUID REFERENCES queues(queue_id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  target_team_id UUID REFERENCES teams(team_id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT routing_rules_name_not_blank CHECK (BTRIM(rule_name) <> ''),
  CONSTRAINT routing_rules_priority_check CHECK (priority BETWEEN 1 AND 10000),
  CONSTRAINT routing_rules_conditions_object CHECK (jsonb_typeof(conditions) = 'object'),
  CONSTRAINT routing_rules_action_check
    CHECK (action_type IN ('queue', 'user', 'team')),
  CONSTRAINT routing_rules_target_check
    CHECK (
      (action_type = 'queue' AND target_queue_id IS NOT NULL AND target_user_id IS NULL AND target_team_id IS NULL)
      OR (action_type = 'user' AND target_queue_id IS NULL AND target_user_id IS NOT NULL AND target_team_id IS NULL)
      OR (action_type = 'team' AND target_queue_id IS NULL AND target_user_id IS NULL AND target_team_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS routing_rules_company_project_name_unique_idx
  ON routing_rules (company_id, COALESCE(project_id, 0), LOWER(rule_name));
CREATE INDEX IF NOT EXISTS routing_rules_match_idx
  ON routing_rules (company_id, project_id, is_active, priority, created_at);

CREATE TABLE IF NOT EXISTS sla_rules (
  sla_rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(project_id) ON DELETE CASCADE,
  rule_name VARCHAR(150) NOT NULL,
  description TEXT,
  applies_to VARCHAR(20) NOT NULL DEFAULT 'assignment',
  priority INTEGER NOT NULL DEFAULT 100,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_minutes INTEGER,
  resolution_minutes INTEGER,
  escalation_minutes INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sla_rules_name_not_blank CHECK (BTRIM(rule_name) <> ''),
  CONSTRAINT sla_rules_applies_to_check CHECK (applies_to IN ('lead', 'assignment')),
  CONSTRAINT sla_rules_priority_check CHECK (priority BETWEEN 1 AND 10000),
  CONSTRAINT sla_rules_conditions_object CHECK (jsonb_typeof(conditions) = 'object'),
  CONSTRAINT sla_rules_deadline_check
    CHECK (response_minutes IS NOT NULL OR resolution_minutes IS NOT NULL),
  CONSTRAINT sla_rules_response_check CHECK (response_minutes IS NULL OR response_minutes > 0),
  CONSTRAINT sla_rules_resolution_check CHECK (resolution_minutes IS NULL OR resolution_minutes > 0),
  CONSTRAINT sla_rules_escalation_check CHECK (escalation_minutes IS NULL OR escalation_minutes >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS sla_rules_company_project_name_unique_idx
  ON sla_rules (company_id, COALESCE(project_id, 0), LOWER(rule_name));
CREATE INDEX IF NOT EXISTS sla_rules_active_idx
  ON sla_rules (company_id, project_id, applies_to, is_active, priority);

CREATE TABLE IF NOT EXISTS sla_instances (
  sla_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sla_rule_id UUID NOT NULL REFERENCES sla_rules(sla_rule_id) ON DELETE RESTRICT,
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(lead_id) ON DELETE CASCADE,
  assignment_id UUID REFERENCES assignments(assignment_id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  response_due_at TIMESTAMPTZ,
  resolution_due_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  breached_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ,
  escalated_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  escalation_notes TEXT,
  waived_at TIMESTAMPTZ,
  waived_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  waiver_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sla_instances_target_check
    CHECK ((lead_id IS NOT NULL)::integer + (assignment_id IS NOT NULL)::integer = 1),
  CONSTRAINT sla_instances_status_check
    CHECK (status IN ('running', 'met', 'breached', 'escalated', 'waived', 'cancelled')),
  CONSTRAINT sla_instances_due_check
    CHECK (response_due_at IS NOT NULL OR resolution_due_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS sla_instances_active_lead_idx
  ON sla_instances (sla_rule_id, lead_id)
  WHERE lead_id IS NOT NULL AND status IN ('running', 'breached', 'escalated');
CREATE UNIQUE INDEX IF NOT EXISTS sla_instances_active_assignment_idx
  ON sla_instances (sla_rule_id, assignment_id)
  WHERE assignment_id IS NOT NULL AND status IN ('running', 'breached', 'escalated');
CREATE INDEX IF NOT EXISTS sla_instances_due_idx
  ON sla_instances (status, response_due_at, resolution_due_at);
CREATE INDEX IF NOT EXISTS sla_instances_project_status_idx
  ON sla_instances (project_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS sla_instance_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sla_id UUID NOT NULL REFERENCES sla_instances(sla_id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL,
  from_status VARCHAR(20),
  to_status VARCHAR(20) NOT NULL,
  notes TEXT,
  performed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sla_instance_history_action_check
    CHECK (action IN ('started', 'responded', 'resolved', 'breached', 'escalated', 'waived', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS sla_instance_history_sla_time_idx
  ON sla_instance_history (sla_id, created_at DESC, history_id DESC);

COMMIT;
