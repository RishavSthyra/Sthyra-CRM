BEGIN;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.role_id, permission.permission_id
FROM roles AS role
JOIN permissions AS permission
  ON permission.permission_key = 'AUDIT_VIEW'
WHERE role.role_key IN ('COMPANY_OWNER', 'COMPANY_ADMIN', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;

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
            FROM users app_user
            JOIN teams app_team ON app_team.team_id = app_user.team_id
            JOIN roles app_role ON app_role.role_id = app_user.role_id
            WHERE app_user.user_id = private.current_crm_user_id()
              AND app_user.is_active = TRUE
              AND app_user.deleted_at IS NULL
              AND app_team.is_active = TRUE
              AND app_team.company_id = audit_logs.company_id
              AND app_role.is_active = TRUE
              AND (
                app_role.role_key IN (
                  'COMPANY_OWNER',
                  'COMPANY_ADMIN',
                  'SUPER_ADMIN'
                )
                OR LOWER(BTRIM(app_team.name)) = 'leadership'
              )
          )
        );
    END IF;
  END IF;
END;
$$;

COMMIT;
