-- The tenant application role intentionally has no direct access to Supabase's
-- auth schema. Evaluate the signed server-request claim through a narrowly
-- scoped security-definer helper so RLS-protected writes can validate it.

BEGIN;

ALTER FUNCTION private.is_trusted_app_request() SECURITY DEFINER;

REVOKE ALL ON FUNCTION private.is_trusted_app_request() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_trusted_app_request()
  TO sthyra_app_server, service_role;

-- These tenant tables were omitted from the initial explicit policy map and
-- therefore correctly failed closed. Add their tenant-scoped policies now.
DROP POLICY IF EXISTS tenant_select ON notes;
DROP POLICY IF EXISTS tenant_server_write ON notes;
CREATE POLICY tenant_select ON notes
  FOR SELECT TO sthyra_app_server
  USING (
    private.is_company_member(company_id)
    AND private.can_access_project(project_id)
  );
CREATE POLICY tenant_server_write ON notes
  FOR ALL TO sthyra_app_server
  USING (
    private.is_company_member(company_id)
    AND private.can_access_project(project_id)
    AND private.is_trusted_app_request()
  )
  WITH CHECK (
    private.is_company_member(company_id)
    AND private.can_access_project(project_id)
    AND private.is_trusted_app_request()
  );

DROP POLICY IF EXISTS tenant_select ON project_inventory_nodes;
DROP POLICY IF EXISTS tenant_server_write ON project_inventory_nodes;
CREATE POLICY tenant_select ON project_inventory_nodes
  FOR SELECT TO sthyra_app_server
  USING (
    private.is_company_member(company_id)
    AND private.can_access_project(project_id)
  );
CREATE POLICY tenant_server_write ON project_inventory_nodes
  FOR ALL TO sthyra_app_server
  USING (
    private.is_company_member(company_id)
    AND private.can_access_project(project_id)
    AND private.is_trusted_app_request()
  )
  WITH CHECK (
    private.is_company_member(company_id)
    AND private.can_access_project(project_id)
    AND private.is_trusted_app_request()
  );

COMMIT;
