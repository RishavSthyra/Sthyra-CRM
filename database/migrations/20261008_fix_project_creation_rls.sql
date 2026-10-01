BEGIN;

-- Creating a project cannot be authorized through can_access_project because
-- the project row does not exist until after the INSERT passes its WITH CHECK.
-- Authorize that one operation at company scope, while retaining the existing
-- project-scoped policy for reads, updates and deletes.
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
        role.role_key IN ('COMPANY_OWNER', 'COMPANY_ADMIN', 'SUPER_ADMIN')
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

REVOKE ALL ON FUNCTION private.can_manage_company_projects(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_manage_company_projects(INTEGER)
  TO sthyra_app_server, service_role;

-- PostgreSQL applies SELECT policies to rows emitted by INSERT ... RETURNING.
-- This direct company-scoped predicate can evaluate the new row without first
-- looking it up in projects, unlike can_access_project(project_id).
DROP POLICY IF EXISTS tenant_project_manager_select ON projects;
CREATE POLICY tenant_project_manager_select ON projects
  FOR SELECT TO sthyra_app_server
  USING (private.can_manage_company_projects(company_id));

DROP POLICY IF EXISTS tenant_server_insert ON projects;
CREATE POLICY tenant_server_insert ON projects
  FOR INSERT TO sthyra_app_server
  WITH CHECK (
    private.can_manage_company_projects(company_id)
    AND private.is_trusted_app_request()
  );

COMMIT;
