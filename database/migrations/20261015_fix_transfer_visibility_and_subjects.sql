BEGIN;

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS subject_name_snapshot TEXT;

UPDATE transfers transfer
SET subject_name_snapshot=COALESCE(
  (
    SELECT COALESCE(
      NULLIF(BTRIM(CONCAT_WS(' ', contact.first_name, contact.last_name)), ''),
      NULLIF(BTRIM(contact.email), ''),
      NULLIF(BTRIM(contact.phone_number), '')
    )
    FROM leads lead
    JOIN contacts contact ON contact.contact_id=lead.contact_id
    WHERE lead.lead_id=transfer.lead_id
  ),
  (
    SELECT COALESCE(
      NULLIF(BTRIM(opportunity.opportunity_name), ''),
      NULLIF(BTRIM(CONCAT_WS(' ', contact.first_name, contact.last_name)), ''),
      NULLIF(BTRIM(contact.email), '')
    )
    FROM opportunities opportunity
    JOIN contacts contact ON contact.contact_id=opportunity.contact_id
    WHERE opportunity.opportunity_id=transfer.opportunity_id
  ),
  CASE transfer.subject_type WHEN 'lead' THEN 'Lead' ELSE 'Opportunity' END
)
WHERE transfer.subject_name_snapshot IS NULL;

UPDATE transfers
SET subject_name_snapshot=CASE subject_type
  WHEN 'lead' THEN 'Lead'
  ELSE 'Opportunity'
END
WHERE subject_name_snapshot IS NULL;

ALTER TABLE transfers
  ALTER COLUMN subject_name_snapshot SET NOT NULL;

CREATE OR REPLACE FUNCTION private.can_access_transfer(target_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM transfers transfer
    JOIN workspace_memberships membership
      ON membership.company_id=transfer.company_id
     AND membership.auth_user_id=(SELECT auth.uid())
     AND membership.is_active=TRUE
    JOIN users crm_user ON crm_user.user_id=membership.crm_user_id
    WHERE transfer.transfer_id=target_id
      AND crm_user.is_active=TRUE
      AND crm_user.deleted_at IS NULL
      AND private.can_access_project(transfer.project_id)
      AND (
        private.has_project_wide_lead_visibility()
        OR transfer.requested_by=crm_user.user_id
        OR transfer.from_owner_user_id=crm_user.user_id
        OR transfer.from_team_id=crm_user.team_id
        OR (
          transfer.submitted_at IS NOT NULL
          AND (
            transfer.to_owner_user_id=crm_user.user_id
            OR transfer.to_team_id=crm_user.team_id
          )
        )
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
        OR EXISTS (
          SELECT 1
          FROM transfers transfer
          WHERE transfer.lead_id=lead.lead_id
            AND transfer.status='submitted'
            AND (
              transfer.to_owner_user_id=crm_user.user_id
              OR transfer.to_team_id=crm_user.team_id
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
        OR EXISTS (
          SELECT 1
          FROM transfers transfer
          WHERE transfer.lead_id=lead.lead_id
            AND transfer.status='submitted'
            AND (
              transfer.to_owner_user_id=crm_user.user_id
              OR transfer.to_team_id=crm_user.team_id
            )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION private.can_access_transfer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_access_transfer(UUID)
  TO sthyra_app_server, service_role;

DROP POLICY IF EXISTS tenant_select ON public.transfers;
DROP POLICY IF EXISTS tenant_server_write ON public.transfers;

CREATE POLICY tenant_select ON public.transfers
  FOR SELECT TO sthyra_app_server
  USING (private.can_access_transfer(transfer_id));

CREATE POLICY tenant_server_write ON public.transfers
  FOR ALL TO sthyra_app_server
  USING (
    private.is_trusted_app_request()
    AND private.can_access_transfer(transfer_id)
  )
  WITH CHECK (
    private.is_trusted_app_request()
    AND private.is_company_member(company_id)
    AND private.can_access_project(project_id)
  );

COMMIT;
