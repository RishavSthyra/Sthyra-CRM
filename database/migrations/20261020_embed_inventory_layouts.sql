BEGIN;

-- Layouts are part of a reusable unit template. Individual inventory units
-- inherit that layout unless they explicitly opt into a private override.
ALTER TABLE inventory_unit_types
  ADD COLUMN IF NOT EXISTS layout_notes TEXT,
  ADD COLUMN IF NOT EXISTS layout_metadata JSONB NOT NULL DEFAULT '{}'::JSONB;
ALTER TABLE inventory_unit_types
  DROP CONSTRAINT IF EXISTS inventory_unit_types_layout_metadata_check;
ALTER TABLE inventory_unit_types
  ADD CONSTRAINT inventory_unit_types_layout_metadata_check
    CHECK (jsonb_typeof(layout_metadata)='object');

ALTER TABLE inventory_units
  ADD COLUMN IF NOT EXISTS layout_mode VARCHAR(20) NOT NULL DEFAULT 'inherited',
  ADD COLUMN IF NOT EXISTS layout_notes TEXT,
  ADD COLUMN IF NOT EXISTS layout_metadata JSONB NOT NULL DEFAULT '{}'::JSONB;
ALTER TABLE inventory_units
  DROP CONSTRAINT IF EXISTS inventory_units_layout_mode_check;
ALTER TABLE inventory_units
  ADD CONSTRAINT inventory_units_layout_mode_check
    CHECK (layout_mode IN ('inherited','custom'));
ALTER TABLE inventory_units
  DROP CONSTRAINT IF EXISTS inventory_units_layout_metadata_check;
ALTER TABLE inventory_units
  ADD CONSTRAINT inventory_units_layout_metadata_check
    CHECK (jsonb_typeof(layout_metadata)='object');

CREATE TABLE IF NOT EXISTS inventory_unit_type_rooms (
  room_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_type_id UUID NOT NULL REFERENCES inventory_unit_types(unit_type_id) ON DELETE CASCADE,
  room_name VARCHAR(150) NOT NULL,
  room_type VARCHAR(80),
  length NUMERIC(10,2),
  width NUMERIC(10,2),
  measurement_unit VARCHAR(8) NOT NULL DEFAULT 'ft',
  area_sqft NUMERIC(12,2),
  notes VARCHAR(500),
  display_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_unit_type_rooms_name_check CHECK (BTRIM(room_name)<>''),
  CONSTRAINT inventory_unit_type_rooms_unit_check CHECK (measurement_unit IN ('ft','m')),
  CONSTRAINT inventory_unit_type_rooms_dimensions_check CHECK (
    (length IS NULL AND width IS NULL) OR (length>0 AND width>0)
  ),
  CONSTRAINT inventory_unit_type_rooms_area_check CHECK (area_sqft IS NULL OR area_sqft>0),
  CONSTRAINT inventory_unit_type_rooms_order_check CHECK (display_order>0)
);
CREATE INDEX IF NOT EXISTS inventory_unit_type_rooms_type_idx
  ON inventory_unit_type_rooms (unit_type_id, display_order, room_id);

CREATE TABLE IF NOT EXISTS inventory_unit_type_layout_assets (
  layout_asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_type_id UUID NOT NULL REFERENCES inventory_unit_types(unit_type_id) ON DELETE CASCADE,
  asset_kind VARCHAR(30) NOT NULL DEFAULT 'floor_plan',
  asset_url TEXT NOT NULL,
  file_name VARCHAR(255),
  mime_type VARCHAR(150),
  display_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_unit_type_layout_assets_kind_check
    CHECK (asset_kind IN ('floor_plan','render','document')),
  CONSTRAINT inventory_unit_type_layout_assets_url_check CHECK (BTRIM(asset_url)<>''),
  CONSTRAINT inventory_unit_type_layout_assets_order_check CHECK (display_order>0),
  UNIQUE (unit_type_id, asset_url)
);
CREATE INDEX IF NOT EXISTS inventory_unit_type_layout_assets_type_idx
  ON inventory_unit_type_layout_assets (unit_type_id, display_order, layout_asset_id);

CREATE TABLE IF NOT EXISTS inventory_unit_rooms (
  room_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES inventory_units(unit_id) ON DELETE CASCADE,
  room_name VARCHAR(150) NOT NULL,
  room_type VARCHAR(80),
  length NUMERIC(10,2),
  width NUMERIC(10,2),
  measurement_unit VARCHAR(8) NOT NULL DEFAULT 'ft',
  area_sqft NUMERIC(12,2),
  notes VARCHAR(500),
  display_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_unit_rooms_name_check CHECK (BTRIM(room_name)<>''),
  CONSTRAINT inventory_unit_rooms_unit_check CHECK (measurement_unit IN ('ft','m')),
  CONSTRAINT inventory_unit_rooms_dimensions_check CHECK (
    (length IS NULL AND width IS NULL) OR (length>0 AND width>0)
  ),
  CONSTRAINT inventory_unit_rooms_area_check CHECK (area_sqft IS NULL OR area_sqft>0),
  CONSTRAINT inventory_unit_rooms_order_check CHECK (display_order>0)
);
CREATE INDEX IF NOT EXISTS inventory_unit_rooms_unit_idx
  ON inventory_unit_rooms (unit_id, display_order, room_id);

CREATE TABLE IF NOT EXISTS inventory_unit_layout_assets (
  layout_asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES inventory_units(unit_id) ON DELETE CASCADE,
  asset_kind VARCHAR(30) NOT NULL DEFAULT 'floor_plan',
  asset_url TEXT NOT NULL,
  file_name VARCHAR(255),
  mime_type VARCHAR(150),
  display_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_unit_layout_assets_kind_check
    CHECK (asset_kind IN ('floor_plan','render','document')),
  CONSTRAINT inventory_unit_layout_assets_url_check CHECK (BTRIM(asset_url)<>''),
  CONSTRAINT inventory_unit_layout_assets_order_check CHECK (display_order>0),
  UNIQUE (unit_id, asset_url)
);
CREATE INDEX IF NOT EXISTS inventory_unit_layout_assets_unit_idx
  ON inventory_unit_layout_assets (unit_id, display_order, layout_asset_id);

-- Preserve every legacy plan file and its raw dimensions on the template that
-- used it. The old tables remain compatibility history for one release and
-- are no longer used by the inventory UI.
UPDATE inventory_unit_types unit_type
SET layout_notes=COALESCE(unit_type.layout_notes,plan.description),
    layout_metadata=unit_type.layout_metadata || jsonb_build_object(
      'migrated_floor_plan',jsonb_build_object(
        'floor_plan_id',plan.floor_plan_id,
        'plan_code',plan.plan_code,
        'plan_name',plan.plan_name,
        'version',plan.version,
        'dimensions',plan.dimensions
      )
    )
FROM inventory_unit_type_floor_plans link
JOIN inventory_floor_plans plan ON plan.floor_plan_id=link.floor_plan_id
WHERE link.unit_type_id=unit_type.unit_type_id AND link.plan_role='primary';

INSERT INTO inventory_unit_type_layout_assets
  (unit_type_id,asset_kind,asset_url,file_name,mime_type,display_order)
SELECT link.unit_type_id,
  CASE WHEN asset.asset_kind IN ('render','document') THEN asset.asset_kind ELSE 'floor_plan' END,
  asset.asset_url,asset.file_name,asset.mime_type,asset.display_order
FROM inventory_unit_type_floor_plans link
JOIN inventory_floor_plan_assets asset ON asset.floor_plan_id=link.floor_plan_id
ON CONFLICT (unit_type_id,asset_url) DO NOTHING;

INSERT INTO inventory_unit_type_rooms
  (unit_type_id,room_name,room_type,length,width,measurement_unit,area_sqft,notes,display_order)
SELECT link.unit_type_id,
  COALESCE(NULLIF(BTRIM(room->>'room_name'),''),NULLIF(BTRIM(room->>'name'),''),'Room'),
  NULLIF(BTRIM(COALESCE(room->>'room_type',room->>'type')),''),
  CASE WHEN COALESCE(room->>'length','') ~ '^[0-9]+(?:\.[0-9]+)?$'
         AND COALESCE(room->>'width','') ~ '^[0-9]+(?:\.[0-9]+)?$'
    THEN (room->>'length')::numeric END,
  CASE WHEN COALESCE(room->>'length','') ~ '^[0-9]+(?:\.[0-9]+)?$'
         AND COALESCE(room->>'width','') ~ '^[0-9]+(?:\.[0-9]+)?$'
    THEN (room->>'width')::numeric END,
  CASE WHEN room->>'measurement_unit'='m' THEN 'm' ELSE 'ft' END,
  CASE WHEN COALESCE(room->>'area_sqft','') ~ '^[0-9]+(?:\.[0-9]+)?$' THEN (room->>'area_sqft')::numeric END,
  NULLIF(BTRIM(room->>'notes'),''),ordinality::integer
FROM inventory_unit_type_floor_plans link
JOIN inventory_floor_plans plan ON plan.floor_plan_id=link.floor_plan_id
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(plan.dimensions->'rooms')='array'
    THEN plan.dimensions->'rooms' ELSE '[]'::jsonb END
) WITH ORDINALITY AS migrated(room,ordinality)
WHERE link.plan_role='primary'
  AND NOT EXISTS (
    SELECT 1 FROM inventory_unit_type_rooms existing
    WHERE existing.unit_type_id=link.unit_type_id
  );

ALTER TABLE inventory_unit_type_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_unit_type_layout_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_unit_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_unit_layout_assets ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  target TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sthyra_app_server') THEN
    FOREACH target IN ARRAY ARRAY[
      'inventory_unit_type_rooms','inventory_unit_type_layout_assets',
      'inventory_unit_rooms','inventory_unit_layout_assets'
    ] LOOP
      EXECUTE FORMAT('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sthyra_app_server',target);
    END LOOP;
    IF TO_REGPROCEDURE('private.is_company_member(integer)') IS NOT NULL
       AND TO_REGPROCEDURE('private.can_access_project(integer)') IS NOT NULL
       AND TO_REGPROCEDURE('private.is_trusted_app_request()') IS NOT NULL THEN
      DROP POLICY IF EXISTS tenant_select ON inventory_unit_type_rooms;
      DROP POLICY IF EXISTS tenant_server_write ON inventory_unit_type_rooms;
      CREATE POLICY tenant_select ON inventory_unit_type_rooms FOR SELECT TO sthyra_app_server
        USING (EXISTS (SELECT 1 FROM inventory_unit_types parent WHERE parent.unit_type_id=inventory_unit_type_rooms.unit_type_id AND private.is_company_member(parent.company_id) AND private.can_access_project(parent.project_id)));
      CREATE POLICY tenant_server_write ON inventory_unit_type_rooms FOR ALL TO sthyra_app_server
        USING (EXISTS (SELECT 1 FROM inventory_unit_types parent WHERE parent.unit_type_id=inventory_unit_type_rooms.unit_type_id AND private.is_company_member(parent.company_id) AND private.can_access_project(parent.project_id)) AND private.is_trusted_app_request())
        WITH CHECK (EXISTS (SELECT 1 FROM inventory_unit_types parent WHERE parent.unit_type_id=inventory_unit_type_rooms.unit_type_id AND private.is_company_member(parent.company_id) AND private.can_access_project(parent.project_id)) AND private.is_trusted_app_request());

      DROP POLICY IF EXISTS tenant_select ON inventory_unit_type_layout_assets;
      DROP POLICY IF EXISTS tenant_server_write ON inventory_unit_type_layout_assets;
      CREATE POLICY tenant_select ON inventory_unit_type_layout_assets FOR SELECT TO sthyra_app_server
        USING (EXISTS (SELECT 1 FROM inventory_unit_types parent WHERE parent.unit_type_id=inventory_unit_type_layout_assets.unit_type_id AND private.is_company_member(parent.company_id) AND private.can_access_project(parent.project_id)));
      CREATE POLICY tenant_server_write ON inventory_unit_type_layout_assets FOR ALL TO sthyra_app_server
        USING (EXISTS (SELECT 1 FROM inventory_unit_types parent WHERE parent.unit_type_id=inventory_unit_type_layout_assets.unit_type_id AND private.is_company_member(parent.company_id) AND private.can_access_project(parent.project_id)) AND private.is_trusted_app_request())
        WITH CHECK (EXISTS (SELECT 1 FROM inventory_unit_types parent WHERE parent.unit_type_id=inventory_unit_type_layout_assets.unit_type_id AND private.is_company_member(parent.company_id) AND private.can_access_project(parent.project_id)) AND private.is_trusted_app_request());

      DROP POLICY IF EXISTS tenant_select ON inventory_unit_rooms;
      DROP POLICY IF EXISTS tenant_server_write ON inventory_unit_rooms;
      CREATE POLICY tenant_select ON inventory_unit_rooms FOR SELECT TO sthyra_app_server
        USING (private.can_access_inventory_unit(unit_id));
      CREATE POLICY tenant_server_write ON inventory_unit_rooms FOR ALL TO sthyra_app_server
        USING (private.can_access_inventory_unit(unit_id) AND private.is_trusted_app_request())
        WITH CHECK (private.can_access_inventory_unit(unit_id) AND private.is_trusted_app_request());

      DROP POLICY IF EXISTS tenant_select ON inventory_unit_layout_assets;
      DROP POLICY IF EXISTS tenant_server_write ON inventory_unit_layout_assets;
      CREATE POLICY tenant_select ON inventory_unit_layout_assets FOR SELECT TO sthyra_app_server
        USING (private.can_access_inventory_unit(unit_id));
      CREATE POLICY tenant_server_write ON inventory_unit_layout_assets FOR ALL TO sthyra_app_server
        USING (private.can_access_inventory_unit(unit_id) AND private.is_trusted_app_request())
        WITH CHECK (private.can_access_inventory_unit(unit_id) AND private.is_trusted_app_request());
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT ALL ON inventory_unit_type_rooms,inventory_unit_type_layout_assets,
      inventory_unit_rooms,inventory_unit_layout_assets TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON inventory_unit_type_rooms,inventory_unit_type_layout_assets,
      inventory_unit_rooms,inventory_unit_layout_assets FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON inventory_unit_type_rooms,inventory_unit_type_layout_assets,
      inventory_unit_rooms,inventory_unit_layout_assets FROM authenticated;
  END IF;
END;
$$;

DO $$
BEGIN
  IF TO_REGPROCEDURE('private.capture_tenant_audit_log()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_audit_log ON inventory_unit_type_rooms;
    CREATE TRIGGER tenant_audit_log AFTER INSERT OR UPDATE OR DELETE ON inventory_unit_type_rooms
      FOR EACH ROW EXECUTE FUNCTION private.capture_tenant_audit_log('room_id');
    DROP TRIGGER IF EXISTS tenant_audit_log ON inventory_unit_type_layout_assets;
    CREATE TRIGGER tenant_audit_log AFTER INSERT OR UPDATE OR DELETE ON inventory_unit_type_layout_assets
      FOR EACH ROW EXECUTE FUNCTION private.capture_tenant_audit_log('layout_asset_id');
    DROP TRIGGER IF EXISTS tenant_audit_log ON inventory_unit_rooms;
    CREATE TRIGGER tenant_audit_log AFTER INSERT OR UPDATE OR DELETE ON inventory_unit_rooms
      FOR EACH ROW EXECUTE FUNCTION private.capture_tenant_audit_log('room_id');
    DROP TRIGGER IF EXISTS tenant_audit_log ON inventory_unit_layout_assets;
    CREATE TRIGGER tenant_audit_log AFTER INSERT OR UPDATE OR DELETE ON inventory_unit_layout_assets
      FOR EACH ROW EXECUTE FUNCTION private.capture_tenant_audit_log('layout_asset_id');
  END IF;
END;
$$;

COMMIT;
