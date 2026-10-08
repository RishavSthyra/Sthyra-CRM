BEGIN;

-- Super Admin is the only built-in workspace authority. Every person who
-- originally created a workspace is promoted before the legacy roles retire.
INSERT INTO roles (role_key, role_name, description, is_system_role)
SELECT
  'SUPER_ADMIN',
  'Super Admin',
  'Highest-authority workspace administrator with unrestricted access',
  TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM roles
  WHERE is_system_role = TRUE
    AND role_key = 'SUPER_ADMIN'
);

UPDATE roles
SET role_name = 'Super Admin',
    description = 'Highest-authority workspace administrator with unrestricted access',
    is_active = TRUE,
    updated_at = CURRENT_TIMESTAMP
WHERE is_system_role = TRUE
  AND role_key = 'SUPER_ADMIN';

INSERT INTO role_permissions (role_id, permission_id)
SELECT super_admin.role_id, permission.permission_id
FROM roles AS super_admin
CROSS JOIN permissions AS permission
WHERE super_admin.is_system_role = TRUE
  AND super_admin.role_key = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

UPDATE users
SET role_id = (
      SELECT role_id
      FROM roles
      WHERE is_system_role = TRUE
        AND role_key = 'SUPER_ADMIN'
      LIMIT 1
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE role_id IN (
  SELECT role_id
  FROM roles
  WHERE is_system_role = TRUE
    AND role_key IN ('COMPANY_OWNER', 'COMPANY_ADMIN')
);

-- Never silently elevate an unaccepted legacy invitation. A Super Admin can
-- send a fresh invitation with the intended custom or Super Admin role.
UPDATE workspace_invitations
SET status = 'revoked',
    revoked_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'pending'
  AND role_id IN (
    SELECT role_id
    FROM roles
    WHERE is_system_role = TRUE
      AND role_key IN ('COMPANY_OWNER', 'COMPANY_ADMIN')
  );

DELETE FROM role_permissions AS role_permission
USING roles AS role
WHERE role_permission.role_id = role.role_id
  AND role.is_system_role = TRUE
  AND role.role_key IN ('COMPANY_OWNER', 'COMPANY_ADMIN');

UPDATE roles
SET is_active = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE is_system_role = TRUE
  AND role_key IN ('COMPANY_OWNER', 'COMPANY_ADMIN');

CREATE OR REPLACE FUNCTION private.can_access_project(target_project_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM projects AS project
    JOIN companies AS company ON company.company_id = project.company_id
    JOIN workspace_memberships AS membership
      ON membership.company_id = project.company_id
     AND membership.auth_user_id = (SELECT auth.uid())
     AND membership.is_active
    JOIN users AS crm_user ON crm_user.user_id = membership.crm_user_id
    JOIN roles AS role ON role.role_id = crm_user.role_id
    WHERE project.project_id = target_project_id
      AND (
        (SELECT private.current_workspace_slug()) IS NULL
        OR company.workspace_slug = (SELECT private.current_workspace_slug())
      )
      AND (
        role.role_key = 'SUPER_ADMIN'
        OR EXISTS (
          SELECT 1
          FROM user_projects AS user_project
          WHERE user_project.user_id = crm_user.user_id
            AND user_project.project_id = project.project_id
        )
        OR EXISTS (
          SELECT 1
          FROM team_projects AS team_project
          WHERE team_project.team_id = crm_user.team_id
            AND team_project.project_id = project.project_id
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION private.can_manage_company_projects(
  target_company_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_memberships AS membership
    JOIN companies AS company ON company.company_id = membership.company_id
    JOIN users AS crm_user
      ON crm_user.user_id = membership.crm_user_id
     AND crm_user.is_active
     AND crm_user.deleted_at IS NULL
    JOIN roles AS role
      ON role.role_id = crm_user.role_id
     AND role.is_active
    WHERE membership.auth_user_id = (SELECT auth.uid())
      AND membership.company_id = target_company_id
      AND membership.is_active
      AND (
        (SELECT private.current_workspace_slug()) IS NULL
        OR company.workspace_slug = (SELECT private.current_workspace_slug())
      )
      AND (
        role.role_key = 'SUPER_ADMIN'
        OR EXISTS (
          SELECT 1
          FROM role_permissions AS role_permission
          JOIN permissions AS permission
            ON permission.permission_id = role_permission.permission_id
          WHERE role_permission.role_id = role.role_id
            AND permission.permission_key = 'PROJECTS_MANAGE'
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION private.has_project_wide_lead_visibility()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_memberships AS membership
    JOIN users AS crm_user ON crm_user.user_id = membership.crm_user_id
    JOIN roles AS role ON role.role_id = crm_user.role_id
    JOIN teams AS team ON team.team_id = crm_user.team_id
    WHERE membership.auth_user_id = (SELECT auth.uid())
      AND membership.is_active = TRUE
      AND crm_user.is_active = TRUE
      AND crm_user.deleted_at IS NULL
      AND role.is_active = TRUE
      AND team.is_active = TRUE
      AND (
        role.role_key = 'SUPER_ADMIN'
        OR LOWER(BTRIM(team.name)) = 'leadership'
        OR private.has_crm_permission('LEADS_ASSIGN')
      )
  )
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sthyra_app_server') THEN
    DROP POLICY IF EXISTS super_admin_select ON audit_logs;
    DROP POLICY IF EXISTS leadership_select ON audit_logs;

    IF TO_REGPROCEDURE('private.is_company_member(integer)') IS NOT NULL
       AND TO_REGPROCEDURE('private.current_crm_user_id()') IS NOT NULL THEN
      CREATE POLICY leadership_select ON audit_logs
        FOR SELECT TO sthyra_app_server
        USING (
          private.is_company_member(company_id)
          AND EXISTS (
            SELECT 1
            FROM users AS app_user
            JOIN teams AS app_team ON app_team.team_id = app_user.team_id
            JOIN roles AS app_role ON app_role.role_id = app_user.role_id
            WHERE app_user.user_id = private.current_crm_user_id()
              AND app_user.is_active = TRUE
              AND app_user.deleted_at IS NULL
              AND app_team.is_active = TRUE
              AND app_team.company_id = audit_logs.company_id
              AND app_role.is_active = TRUE
              AND (
                app_role.role_key = 'SUPER_ADMIN'
                OR LOWER(BTRIM(app_team.name)) = 'leadership'
              )
          )
        );
    END IF;
  END IF;
END;
$$;

COMMIT;
