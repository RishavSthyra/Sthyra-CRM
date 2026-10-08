BEGIN;

CREATE OR REPLACE FUNCTION private.has_crm_permission(target_permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_memberships membership
    JOIN users crm_user ON crm_user.user_id=membership.crm_user_id
    JOIN roles role ON role.role_id=crm_user.role_id
    JOIN role_permissions role_permission ON role_permission.role_id=role.role_id
    JOIN permissions permission
      ON permission.permission_id=role_permission.permission_id
    WHERE membership.auth_user_id=(SELECT auth.uid())
      AND membership.is_active=TRUE
      AND crm_user.is_active=TRUE
      AND crm_user.deleted_at IS NULL
      AND role.is_active=TRUE
      AND permission.permission_key=target_permission_key
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
    FROM workspace_memberships membership
    JOIN users crm_user ON crm_user.user_id=membership.crm_user_id
    JOIN roles role ON role.role_id=crm_user.role_id
    JOIN teams team ON team.team_id=crm_user.team_id
    WHERE membership.auth_user_id=(SELECT auth.uid())
      AND membership.is_active=TRUE
      AND crm_user.is_active=TRUE
      AND crm_user.deleted_at IS NULL
      AND role.is_active=TRUE
      AND team.is_active=TRUE
      AND (
        role.role_key IN ('COMPANY_OWNER', 'COMPANY_ADMIN', 'SUPER_ADMIN')
        OR LOWER(BTRIM(team.name))='leadership'
        OR private.has_crm_permission('LEADS_ASSIGN')
      )
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_lead(target_lead_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM leads lead
    JOIN workspace_memberships membership
      ON membership.company_id=lead.company_id
     AND membership.auth_user_id=(SELECT auth.uid())
     AND membership.is_active=TRUE
    JOIN users crm_user ON crm_user.user_id=membership.crm_user_id
    WHERE lead.lead_id=target_lead_id
      AND crm_user.is_active=TRUE
      AND crm_user.deleted_at IS NULL
      AND private.can_access_project(lead.project_id)
      AND (
        private.has_project_wide_lead_visibility()
        OR lead.current_owner_user_id=crm_user.user_id
        OR lead.current_team_id=crm_user.team_id
        OR EXISTS (
          SELECT 1
          FROM assignments assignment
          WHERE assignment.lead_id=lead.lead_id
            AND assignment.status IN ('pending', 'accepted')
            AND (
              assignment.assigned_to_user_id=crm_user.user_id
              OR assignment.assigned_to_team_id=crm_user.team_id
            )
        )
        OR (
          lead.current_owner_user_id IS NULL
          AND lead.current_team_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM queue_records queue_record
            JOIN queue_members queue_member
              ON queue_member.queue_id=queue_record.queue_id
             AND queue_member.user_id=crm_user.user_id
             AND queue_member.is_active=TRUE
            JOIN queues queue ON queue.queue_id=queue_record.queue_id
            WHERE queue_record.lead_id=lead.lead_id
              AND queue_record.status IN ('waiting', 'claimed')
              AND queue.is_active=TRUE
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION private.can_manage_lead(target_lead_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM leads lead
    JOIN workspace_memberships membership
      ON membership.company_id=lead.company_id
     AND membership.auth_user_id=(SELECT auth.uid())
     AND membership.is_active=TRUE
    JOIN users crm_user ON crm_user.user_id=membership.crm_user_id
    WHERE lead.lead_id=target_lead_id
      AND crm_user.is_active=TRUE
      AND crm_user.deleted_at IS NULL
      AND private.can_access_project(lead.project_id)
      AND (
        private.has_project_wide_lead_visibility()
        OR (
          private.has_crm_permission('LEADS_UPDATE')
          AND (
            lead.current_owner_user_id=crm_user.user_id
            OR lead.current_team_id=crm_user.team_id
          )
        )
        OR EXISTS (
          SELECT 1
          FROM assignments assignment
          WHERE assignment.lead_id=lead.lead_id
            AND assignment.status IN ('pending', 'accepted')
            AND (
              assignment.assigned_to_user_id=crm_user.user_id
              OR assignment.assigned_to_team_id=crm_user.team_id
            )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION private.has_crm_permission(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.has_project_wide_lead_visibility() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_access_lead(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_manage_lead(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_crm_permission(TEXT)
  TO sthyra_app_server, service_role;
GRANT EXECUTE ON FUNCTION private.has_project_wide_lead_visibility()
  TO sthyra_app_server, service_role;
GRANT EXECUTE ON FUNCTION private.can_access_lead(UUID)
  TO sthyra_app_server, service_role;
GRANT EXECUTE ON FUNCTION private.can_manage_lead(UUID)
  TO sthyra_app_server, service_role;

DROP POLICY IF EXISTS tenant_select ON public.leads;
DROP POLICY IF EXISTS tenant_server_write ON public.leads;
DROP POLICY IF EXISTS tenant_server_insert ON public.leads;
DROP POLICY IF EXISTS tenant_server_update ON public.leads;
DROP POLICY IF EXISTS tenant_server_delete ON public.leads;

CREATE POLICY tenant_select ON public.leads
  FOR SELECT TO sthyra_app_server
  USING (private.can_access_lead(lead_id));

CREATE POLICY tenant_server_insert ON public.leads
  FOR INSERT TO sthyra_app_server
  WITH CHECK (
    private.is_trusted_app_request()
    AND private.is_company_member(company_id)
    AND private.can_access_project(project_id)
    AND (
      private.has_project_wide_lead_visibility()
      OR private.has_crm_permission('LEADS_CREATE')
    )
  );

CREATE POLICY tenant_server_update ON public.leads
  FOR UPDATE TO sthyra_app_server
  USING (
    private.is_trusted_app_request()
    AND private.can_manage_lead(lead_id)
  )
  WITH CHECK (
    private.is_trusted_app_request()
    AND private.is_company_member(company_id)
    AND private.can_access_project(project_id)
  );

CREATE POLICY tenant_server_delete ON public.leads
  FOR DELETE TO sthyra_app_server
  USING (
    private.is_trusted_app_request()
    AND private.has_project_wide_lead_visibility()
    AND private.can_access_project(project_id)
  );

DROP POLICY IF EXISTS tenant_server_write ON public.lead_attributions;
CREATE POLICY tenant_server_write ON public.lead_attributions
  FOR ALL TO sthyra_app_server
  USING (
    private.is_trusted_app_request()
    AND private.can_manage_lead(lead_id)
  )
  WITH CHECK (
    private.is_trusted_app_request()
    AND private.can_manage_lead(lead_id)
  );

DROP POLICY IF EXISTS tenant_server_write ON public.lead_next_actions;
CREATE POLICY tenant_server_write ON public.lead_next_actions
  FOR ALL TO sthyra_app_server
  USING (
    private.is_trusted_app_request()
    AND private.can_manage_lead(lead_id)
  )
  WITH CHECK (
    private.is_trusted_app_request()
    AND private.can_manage_lead(lead_id)
  );

DROP POLICY IF EXISTS tenant_server_write ON public.lead_tags;
CREATE POLICY tenant_server_write ON public.lead_tags
  FOR ALL TO sthyra_app_server
  USING (
    private.is_trusted_app_request()
    AND private.can_manage_lead(lead_id)
  )
  WITH CHECK (
    private.is_trusted_app_request()
    AND private.can_manage_lead(lead_id)
    AND EXISTS (
      SELECT 1 FROM tags tag
      WHERE tag.tag_id=lead_tags.tag_id
        AND private.is_company_member(tag.company_id)
    )
  );

COMMIT;
