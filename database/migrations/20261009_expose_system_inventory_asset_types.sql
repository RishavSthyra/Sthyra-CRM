BEGIN;

-- System asset types are shared catalogue rows and intentionally have no
-- company_id. The original tenant SELECT policy treated that NULL as a failed
-- membership check, hiding Apartment, Villa, Plot, and the other defaults from
-- every workspace. Expose system rows for reading while retaining tenant
-- isolation for company-owned custom types. The existing write policy remains
-- unchanged, so system rows cannot be modified through the tenant role.
DROP POLICY IF EXISTS tenant_select ON inventory_asset_types;
CREATE POLICY tenant_select ON inventory_asset_types
  FOR SELECT TO sthyra_app_server
  USING (
    (is_system = TRUE AND company_id IS NULL)
    OR private.is_company_member(company_id)
  );

COMMIT;
