BEGIN;

CREATE OR REPLACE FUNCTION private.can_access_transfer_values(
  target_company_id INTEGER,
  target_project_id INTEGER,
  target_requested_by UUID,
  target_from_owner_user_id UUID,
  target_from_team_id UUID,
  target_to_owner_user_id UUID,
  target_to_team_id UUID,
  target_submitted_at TIMESTAMPTZ
)
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
    WHERE membership.company_id=target_company_id
      AND membership.auth_user_id=(SELECT auth.uid())
      AND membership.is_active=TRUE
      AND crm_user.is_active=TRUE
      AND crm_user.deleted_at IS NULL
      AND private.can_access_project(target_project_id)
      AND (
        private.has_project_wide_lead_visibility()
        OR target_requested_by=crm_user.user_id
        OR target_from_owner_user_id=crm_user.user_id
        OR target_from_team_id=crm_user.team_id
        OR (
          target_submitted_at IS NOT NULL
          AND (
            target_to_owner_user_id=crm_user.user_id
            OR target_to_team_id=crm_user.team_id
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_transfer(target_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT private.can_access_transfer_values(
    transfer.company_id,
    transfer.project_id,
    transfer.requested_by,
    transfer.from_owner_user_id,
    transfer.from_team_id,
    transfer.to_owner_user_id,
    transfer.to_team_id,
    transfer.submitted_at
  )
  FROM transfers transfer
  WHERE transfer.transfer_id=target_id
$$;

REVOKE ALL ON FUNCTION private.can_access_transfer_values(
  INTEGER, INTEGER, UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_access_transfer_values(
  INTEGER, INTEGER, UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ
) TO sthyra_app_server, service_role;

DROP POLICY IF EXISTS tenant_select ON public.transfers;
DROP POLICY IF EXISTS tenant_server_write ON public.transfers;

CREATE POLICY tenant_select ON public.transfers
  FOR SELECT TO sthyra_app_server
  USING (
    private.can_access_transfer_values(
      company_id, project_id, requested_by, from_owner_user_id, from_team_id,
      to_owner_user_id, to_team_id, submitted_at
    )
  );

CREATE POLICY tenant_server_write ON public.transfers
  FOR ALL TO sthyra_app_server
  USING (
    private.is_trusted_app_request()
    AND private.can_access_transfer_values(
      company_id, project_id, requested_by, from_owner_user_id, from_team_id,
      to_owner_user_id, to_team_id, submitted_at
    )
  )
  WITH CHECK (
    private.is_trusted_app_request()
    AND private.can_access_transfer_values(
      company_id, project_id, requested_by, from_owner_user_id, from_team_id,
      to_owner_user_id, to_team_id, submitted_at
    )
  );

COMMIT;
