BEGIN;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tasks_project_active_status_due_idx
  ON tasks (project_id, status, due_at, created_at DESC)
  WHERE deleted_at IS NULL;

INSERT INTO permissions (
  permission_key, permission_name, feature_key, action, description
) VALUES
  (
    'ACTIVITIES_EDIT',
    'Edit activities',
    'ACTIVITIES',
    'edit',
    'Edit tasks and change their workflow status'
  ),
  (
    'ACTIVITIES_DELETE',
    'Delete activities',
    'ACTIVITIES',
    'delete',
    'Delete tasks while retaining their audit history'
  )
ON CONFLICT (permission_key) DO UPDATE SET
  permission_name=EXCLUDED.permission_name,
  feature_key=EXCLUDED.feature_key,
  action=EXCLUDED.action,
  description=EXCLUDED.description,
  updated_at=CURRENT_TIMESTAMP;

-- Workspace administrators retain these controls. Custom roles must be
-- granted them explicitly from Settings → Roles and permissions.
INSERT INTO role_permissions (role_id, permission_id)
SELECT role.role_id, permission.permission_id
FROM roles role
CROSS JOIN permissions permission
WHERE role.role_key IN ('COMPANY_OWNER', 'COMPANY_ADMIN', 'SUPER_ADMIN')
  AND permission.permission_key IN ('ACTIVITIES_EDIT', 'ACTIVITIES_DELETE')
ON CONFLICT DO NOTHING;

COMMIT;
