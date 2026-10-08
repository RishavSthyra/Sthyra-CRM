BEGIN;

CREATE TABLE IF NOT EXISTS workspace_invitation_projects (
  invitation_id UUID NOT NULL
    REFERENCES workspace_invitations(invitation_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (invitation_id, project_id)
);

CREATE INDEX IF NOT EXISTS workspace_invitation_projects_project_idx
  ON workspace_invitation_projects (project_id);

ALTER TABLE workspace_invitation_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_invitation_projects FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON workspace_invitation_projects;
CREATE POLICY tenant_select ON workspace_invitation_projects
  FOR SELECT TO sthyra_app_server
  USING (
    private.can_access_project(project_id)
    AND EXISTS (
      SELECT 1
      FROM workspace_invitations wi
      JOIN projects p ON p.project_id = workspace_invitation_projects.project_id
      WHERE wi.invitation_id = workspace_invitation_projects.invitation_id
        AND wi.company_id = p.company_id
        AND private.is_company_member(wi.company_id)
    )
  );

DROP POLICY IF EXISTS tenant_server_write ON workspace_invitation_projects;
CREATE POLICY tenant_server_write ON workspace_invitation_projects
  FOR ALL TO sthyra_app_server
  USING (
    private.can_access_project(project_id)
    AND private.is_trusted_app_request()
    AND EXISTS (
      SELECT 1
      FROM workspace_invitations wi
      JOIN projects p ON p.project_id = workspace_invitation_projects.project_id
      WHERE wi.invitation_id = workspace_invitation_projects.invitation_id
        AND wi.company_id = p.company_id
        AND private.is_company_member(wi.company_id)
    )
  )
  WITH CHECK (
    private.can_access_project(project_id)
    AND private.is_trusted_app_request()
    AND EXISTS (
      SELECT 1
      FROM workspace_invitations wi
      JOIN projects p ON p.project_id = workspace_invitation_projects.project_id
      WHERE wi.invitation_id = workspace_invitation_projects.invitation_id
        AND wi.company_id = p.company_id
        AND private.is_company_member(wi.company_id)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE workspace_invitation_projects TO sthyra_app_server;

COMMIT;
