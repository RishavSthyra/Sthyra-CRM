BEGIN;

-- Align the pre-existing Nykaa tenant record with the hostname already used in
-- production. The original company code remains unchanged.
UPDATE companies
SET workspace_slug = 'nykaa',
    workspace_domain = 'nykaa.crm.sthyra.com',
    workspace_domain_updated_at = CURRENT_TIMESTAMP
WHERE company_code = 'NKYAA'
  AND workspace_slug = 'nkyaa'
  AND NOT EXISTS (
    SELECT 1
    FROM companies existing
    WHERE existing.company_id <> companies.company_id
      AND (
        existing.workspace_slug = 'nykaa'
        OR existing.workspace_domain = 'nykaa.crm.sthyra.com'
      )
  );

-- The application signs the tenant subdomain into request.jwt.claims. RLS uses
-- that claim in addition to the Supabase subject so a valid session from one
-- workspace cannot read another workspace through a sibling hostname.
CREATE OR REPLACE FUNCTION private.current_workspace_slug()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, pg_temp
AS $$
  SELECT NULLIF((SELECT auth.jwt() ->> 'workspace_slug'), '')
$$;

REVOKE ALL ON FUNCTION private.current_workspace_slug()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.current_workspace_slug()
  TO sthyra_app_server, service_role;

CREATE OR REPLACE FUNCTION private.current_crm_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT membership.crm_user_id
  FROM workspace_memberships AS membership
  JOIN companies AS company ON company.company_id = membership.company_id
  WHERE membership.auth_user_id = (SELECT auth.uid())
    AND membership.is_active
    AND (
      (SELECT private.current_workspace_slug()) IS NULL
      OR company.workspace_slug = (SELECT private.current_workspace_slug())
    )
  ORDER BY membership.is_default DESC, membership.joined_at
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.is_company_member(target_company_id INTEGER)
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
    WHERE membership.auth_user_id = (SELECT auth.uid())
      AND membership.company_id = target_company_id
      AND membership.is_active
      AND (
        (SELECT private.current_workspace_slug()) IS NULL
        OR company.workspace_slug = (SELECT private.current_workspace_slug())
      )
  )
$$;

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
        role.role_key IN ('COMPANY_OWNER', 'COMPANY_ADMIN', 'SUPER_ADMIN')
        OR EXISTS (
          SELECT 1 FROM user_projects AS user_project
          WHERE user_project.user_id = crm_user.user_id
            AND user_project.project_id = project.project_id
        )
        OR EXISTS (
          SELECT 1 FROM team_projects AS team_project
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

REVOKE ALL ON FUNCTION private.current_crm_user_id()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_company_member(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_access_project(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_manage_company_projects(INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.current_crm_user_id()
  TO sthyra_app_server, service_role;
GRANT EXECUTE ON FUNCTION private.is_company_member(INTEGER)
  TO sthyra_app_server, service_role;
GRANT EXECUTE ON FUNCTION private.can_access_project(INTEGER)
  TO sthyra_app_server, service_role;
GRANT EXECUTE ON FUNCTION private.can_manage_company_projects(INTEGER)
  TO sthyra_app_server, service_role;

COMMIT;
