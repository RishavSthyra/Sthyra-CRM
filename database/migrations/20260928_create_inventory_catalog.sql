BEGIN;

-- Inventory is deliberately split into reusable catalogue data and individual
-- sellable units. This supports apartments, villas, plots, commercial stock,
-- and project-specific asset types without changing the schema.
CREATE TABLE IF NOT EXISTS inventory_asset_types (
  asset_type_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER REFERENCES companies(company_id) ON DELETE CASCADE,
  type_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  description TEXT,
  icon_key VARCHAR(80),
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  attribute_schema JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_asset_types_key_check
    CHECK (type_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  CONSTRAINT inventory_asset_types_name_not_blank CHECK (BTRIM(display_name)<>''),
  CONSTRAINT inventory_asset_types_schema_check CHECK (jsonb_typeof(attribute_schema)='object'),
  CONSTRAINT inventory_asset_types_system_owner_check
    CHECK ((is_system=TRUE AND company_id IS NULL) OR (is_system=FALSE AND company_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_asset_types_system_key_uidx
  ON inventory_asset_types (type_key) WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_asset_types_company_key_uidx
  ON inventory_asset_types (company_id, type_key) WHERE company_id IS NOT NULL;

INSERT INTO inventory_asset_types
  (type_key, display_name, description, icon_key, is_system)
SELECT seed.type_key, seed.display_name, seed.description, seed.icon_key, TRUE
FROM (VALUES
  ('apartment', 'Apartment', 'A flat within a tower, wing, or building.', 'building-2'),
  ('villa', 'Villa', 'A standalone or clustered residential villa.', 'house'),
  ('plot', 'Plot', 'A residential or commercial land parcel.', 'map'),
  ('office', 'Office', 'An office suite or commercial workspace.', 'briefcase-business'),
  ('retail', 'Retail', 'A shop, showroom, or retail space.', 'store'),
  ('parking', 'Parking', 'A separately tracked parking space.', 'square-parking'),
  ('warehouse', 'Warehouse', 'An industrial or storage unit.', 'warehouse'),
  ('other', 'Other', 'A project-specific inventory asset.', 'boxes')
) AS seed(type_key, display_name, description, icon_key)
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_asset_types existing
  WHERE existing.company_id IS NULL AND existing.type_key=seed.type_key
);

-- A generic adjacency-list hierarchy avoids hard-coding tower/floor. Example:
-- Phase 1 > Tower A > Floor 5, or Phase 2 > Villa Cluster > Street 3.
CREATE TABLE IF NOT EXISTS project_inventory_nodes (
  node_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  parent_node_id UUID REFERENCES project_inventory_nodes(node_id) ON DELETE RESTRICT,
  node_kind VARCHAR(80) NOT NULL,
  node_code VARCHAR(100) NOT NULL,
  node_name VARCHAR(200) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  attributes JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT project_inventory_nodes_kind_not_blank CHECK (BTRIM(node_kind)<>''),
  CONSTRAINT project_inventory_nodes_code_not_blank CHECK (BTRIM(node_code)<>''),
  CONSTRAINT project_inventory_nodes_name_not_blank CHECK (BTRIM(node_name)<>''),
  CONSTRAINT project_inventory_nodes_attributes_check CHECK (jsonb_typeof(attributes)='object'),
  CONSTRAINT project_inventory_nodes_not_self_parent CHECK (parent_node_id IS NULL OR parent_node_id<>node_id),
  UNIQUE (project_id, node_code)
);
CREATE INDEX IF NOT EXISTS project_inventory_nodes_parent_idx
  ON project_inventory_nodes (project_id, parent_node_id, sort_order, node_name);

CREATE TABLE IF NOT EXISTS inventory_unit_types (
  unit_type_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  asset_type_id UUID NOT NULL REFERENCES inventory_asset_types(asset_type_id) ON DELETE RESTRICT,
  type_code VARCHAR(100) NOT NULL,
  type_name VARCHAR(200) NOT NULL,
  configuration VARCHAR(100),
  bedrooms NUMERIC(4,1),
  bathrooms NUMERIC(4,1),
  balconies NUMERIC(4,1),
  carpet_area_sqft NUMERIC(12,2),
  built_up_area_sqft NUMERIC(12,2),
  saleable_area_sqft NUMERIC(12,2),
  base_price NUMERIC(16,2),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  specifications JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_unit_types_code_not_blank CHECK (BTRIM(type_code)<>''),
  CONSTRAINT inventory_unit_types_name_not_blank CHECK (BTRIM(type_name)<>''),
  CONSTRAINT inventory_unit_types_rooms_check CHECK (
    (bedrooms IS NULL OR bedrooms>=0) AND
    (bathrooms IS NULL OR bathrooms>=0) AND
    (balconies IS NULL OR balconies>=0)
  ),
  CONSTRAINT inventory_unit_types_area_check CHECK (
    (carpet_area_sqft IS NULL OR carpet_area_sqft>0) AND
    (built_up_area_sqft IS NULL OR built_up_area_sqft>0) AND
    (saleable_area_sqft IS NULL OR saleable_area_sqft>0)
  ),
  CONSTRAINT inventory_unit_types_price_check CHECK (base_price IS NULL OR base_price>=0),
  CONSTRAINT inventory_unit_types_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT inventory_unit_types_specs_check CHECK (jsonb_typeof(specifications)='object'),
  UNIQUE (project_id, type_code)
);
CREATE INDEX IF NOT EXISTS inventory_unit_types_project_idx
  ON inventory_unit_types (project_id, asset_type_id, is_active, type_name);

CREATE TABLE IF NOT EXISTS inventory_floor_plans (
  floor_plan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  plan_code VARCHAR(100) NOT NULL,
  plan_name VARCHAR(200) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  dimensions JSONB NOT NULL DEFAULT '{}'::JSONB,
  content_hash VARCHAR(128),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_floor_plans_code_not_blank CHECK (BTRIM(plan_code)<>''),
  CONSTRAINT inventory_floor_plans_name_not_blank CHECK (BTRIM(plan_name)<>''),
  CONSTRAINT inventory_floor_plans_version_check CHECK (version>0),
  CONSTRAINT inventory_floor_plans_dimensions_check CHECK (jsonb_typeof(dimensions)='object'),
  UNIQUE (project_id, plan_code, version)
);
CREATE INDEX IF NOT EXISTS inventory_floor_plans_project_idx
  ON inventory_floor_plans (project_id, is_active, plan_name);

CREATE TABLE IF NOT EXISTS inventory_unit_type_floor_plans (
  unit_type_id UUID NOT NULL REFERENCES inventory_unit_types(unit_type_id) ON DELETE CASCADE,
  floor_plan_id UUID NOT NULL REFERENCES inventory_floor_plans(floor_plan_id) ON DELETE RESTRICT,
  plan_role VARCHAR(40) NOT NULL DEFAULT 'primary',
  display_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (unit_type_id, floor_plan_id),
  CONSTRAINT inventory_unit_type_floor_plans_role_not_blank CHECK (BTRIM(plan_role)<>''),
  CONSTRAINT inventory_unit_type_floor_plans_order_check CHECK (display_order>0)
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_unit_type_primary_plan_uidx
  ON inventory_unit_type_floor_plans (unit_type_id) WHERE plan_role='primary';

CREATE TABLE IF NOT EXISTS inventory_floor_plan_assets (
  asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_plan_id UUID NOT NULL REFERENCES inventory_floor_plans(floor_plan_id) ON DELETE CASCADE,
  asset_kind VARCHAR(40) NOT NULL,
  asset_url TEXT NOT NULL,
  file_name VARCHAR(255),
  mime_type VARCHAR(150),
  file_size_bytes BIGINT,
  display_order INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_floor_plan_assets_kind_not_blank CHECK (BTRIM(asset_kind)<>''),
  CONSTRAINT inventory_floor_plan_assets_url_not_blank CHECK (BTRIM(asset_url)<>''),
  CONSTRAINT inventory_floor_plan_assets_size_check CHECK (file_size_bytes IS NULL OR file_size_bytes>=0),
  CONSTRAINT inventory_floor_plan_assets_order_check CHECK (display_order>0),
  CONSTRAINT inventory_floor_plan_assets_metadata_check CHECK (jsonb_typeof(metadata)='object'),
  UNIQUE (floor_plan_id, asset_url)
);

-- Upgrade the earlier site-visit inventory table without breaking existing data.
ALTER TABLE inventory_units ADD COLUMN IF NOT EXISTS node_id UUID REFERENCES project_inventory_nodes(node_id) ON DELETE RESTRICT;
ALTER TABLE inventory_units ADD COLUMN IF NOT EXISTS unit_type_id UUID REFERENCES inventory_unit_types(unit_type_id) ON DELETE RESTRICT;
ALTER TABLE inventory_units ADD COLUMN IF NOT EXISTS external_unit_key VARCHAR(200);
ALTER TABLE inventory_units ADD COLUMN IF NOT EXISTS orientation VARCHAR(100);
ALTER TABLE inventory_units ADD COLUMN IF NOT EXISTS price_override NUMERIC(16,2);
ALTER TABLE inventory_units ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'INR';
ALTER TABLE inventory_units ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE inventory_units ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE inventory_units DROP CONSTRAINT IF EXISTS inventory_units_price_override_check;
ALTER TABLE inventory_units ADD CONSTRAINT inventory_units_price_override_check
  CHECK (price_override IS NULL OR price_override>=0);
ALTER TABLE inventory_units DROP CONSTRAINT IF EXISTS inventory_units_currency_check;
ALTER TABLE inventory_units ADD CONSTRAINT inventory_units_currency_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE inventory_units DROP CONSTRAINT IF EXISTS inventory_units_version_check;
ALTER TABLE inventory_units ADD CONSTRAINT inventory_units_version_check CHECK (version>0);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_units_external_key_uidx
  ON inventory_units (project_id, external_unit_key)
  WHERE external_unit_key IS NOT NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS inventory_units_catalog_idx
  ON inventory_units (project_id, unit_type_id, node_id, status)
  WHERE archived_at IS NULL;

-- Preserve units created by the earlier site-visit migration. Their legacy
-- tower/floor/configuration values are converted into the new catalogue and
-- hierarchy while the old columns remain available during the transition.
INSERT INTO inventory_unit_types
  (company_id, project_id, asset_type_id, type_code, type_name, configuration)
SELECT DISTINCT iu.company_id, iu.project_id, asset.asset_type_id,
  'LEGACY-' || SUBSTR(MD5(COALESCE(NULLIF(BTRIM(iu.configuration),''),'unspecified')),1,12),
  COALESCE(NULLIF(BTRIM(iu.configuration),''),'Unspecified legacy type'),
  NULLIF(BTRIM(iu.configuration),'')
FROM inventory_units iu
CROSS JOIN LATERAL (
  SELECT asset_type_id FROM inventory_asset_types
  WHERE company_id IS NULL AND type_key='other' LIMIT 1
) asset
WHERE iu.unit_type_id IS NULL
ON CONFLICT (project_id, type_code) DO NOTHING;

UPDATE inventory_units iu
SET unit_type_id=unit_type.unit_type_id
FROM inventory_unit_types unit_type
WHERE iu.unit_type_id IS NULL
  AND unit_type.project_id=iu.project_id
  AND unit_type.type_code='LEGACY-' || SUBSTR(MD5(COALESCE(NULLIF(BTRIM(iu.configuration),''),'unspecified')),1,12);

INSERT INTO project_inventory_nodes
  (company_id, project_id, node_kind, node_code, node_name)
SELECT DISTINCT iu.company_id, iu.project_id, 'tower',
  'LEGACY-TOWER-' || SUBSTR(MD5(BTRIM(iu.tower)),1,12), BTRIM(iu.tower)
FROM inventory_units iu
WHERE NULLIF(BTRIM(iu.tower),'') IS NOT NULL
ON CONFLICT (project_id, node_code) DO NOTHING;

INSERT INTO project_inventory_nodes
  (company_id, project_id, parent_node_id, node_kind, node_code, node_name)
SELECT DISTINCT iu.company_id, iu.project_id, tower.node_id, 'floor',
  'LEGACY-FLOOR-' || SUBSTR(MD5(COALESCE(NULLIF(BTRIM(iu.tower),''),'') || ':' || BTRIM(iu.floor)),1,12),
  BTRIM(iu.floor)
FROM inventory_units iu
LEFT JOIN project_inventory_nodes tower
  ON tower.project_id=iu.project_id
 AND tower.node_code='LEGACY-TOWER-' || SUBSTR(MD5(BTRIM(iu.tower)),1,12)
WHERE NULLIF(BTRIM(iu.floor),'') IS NOT NULL
ON CONFLICT (project_id, node_code) DO NOTHING;

UPDATE inventory_units iu
SET node_id=COALESCE(
  (
    SELECT node_id FROM project_inventory_nodes floor_node
    WHERE floor_node.project_id=iu.project_id
      AND floor_node.node_code='LEGACY-FLOOR-' || SUBSTR(MD5(
        COALESCE(NULLIF(BTRIM(iu.tower),''),'') || ':' || COALESCE(NULLIF(BTRIM(iu.floor),''),'')
      ),1,12)
    LIMIT 1
  ),
  (
    SELECT node_id FROM project_inventory_nodes tower_node
    WHERE tower_node.project_id=iu.project_id
      AND tower_node.node_code='LEGACY-TOWER-' || SUBSTR(MD5(BTRIM(iu.tower)),1,12)
    LIMIT 1
  )
)
WHERE iu.node_id IS NULL
  AND (NULLIF(BTRIM(iu.tower),'') IS NOT NULL OR NULLIF(BTRIM(iu.floor),'') IS NOT NULL);

CREATE TABLE IF NOT EXISTS inventory_attribute_definitions (
  definition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  applies_to VARCHAR(20) NOT NULL,
  attribute_key VARCHAR(100) NOT NULL,
  label VARCHAR(150) NOT NULL,
  data_type VARCHAR(20) NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  options JSONB NOT NULL DEFAULT '[]'::JSONB,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_attribute_definitions_scope_check CHECK (applies_to IN ('unit_type','unit')),
  CONSTRAINT inventory_attribute_definitions_key_check CHECK (attribute_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  CONSTRAINT inventory_attribute_definitions_type_check CHECK (data_type IN ('text','number','boolean','date','select','multi_select')),
  CONSTRAINT inventory_attribute_definitions_options_check CHECK (jsonb_typeof(options)='array'),
  UNIQUE (project_id, applies_to, attribute_key)
);

CREATE TABLE IF NOT EXISTS inventory_price_books (
  price_book_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  price_book_code VARCHAR(100) NOT NULL,
  price_book_name VARCHAR(200) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  valid_from DATE,
  valid_until DATE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_price_books_code_not_blank CHECK (BTRIM(price_book_code)<>''),
  CONSTRAINT inventory_price_books_name_not_blank CHECK (BTRIM(price_book_name)<>''),
  CONSTRAINT inventory_price_books_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT inventory_price_books_dates_check CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until>=valid_from),
  UNIQUE (project_id, price_book_code)
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_price_books_default_uidx
  ON inventory_price_books (project_id) WHERE is_default=TRUE AND is_active=TRUE;

CREATE TABLE IF NOT EXISTS inventory_price_book_entries (
  price_entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_book_id UUID NOT NULL REFERENCES inventory_price_books(price_book_id) ON DELETE CASCADE,
  unit_type_id UUID REFERENCES inventory_unit_types(unit_type_id) ON DELETE CASCADE,
  unit_id UUID REFERENCES inventory_units(unit_id) ON DELETE CASCADE,
  base_amount NUMERIC(16,2) NOT NULL,
  components JSONB NOT NULL DEFAULT '{}'::JSONB,
  valid_from DATE,
  valid_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_price_book_entries_target_check CHECK ((unit_type_id IS NULL)<>(unit_id IS NULL)),
  CONSTRAINT inventory_price_book_entries_amount_check CHECK (base_amount>=0),
  CONSTRAINT inventory_price_book_entries_components_check CHECK (jsonb_typeof(components)='object'),
  CONSTRAINT inventory_price_book_entries_dates_check CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until>=valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_price_entries_type_uidx
  ON inventory_price_book_entries (price_book_id, unit_type_id, COALESCE(valid_from, DATE '0001-01-01'))
  WHERE unit_type_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_price_entries_unit_uidx
  ON inventory_price_book_entries (price_book_id, unit_id, COALESCE(valid_from, DATE '0001-01-01'))
  WHERE unit_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_unit_status_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES inventory_units(unit_id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  performed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_unit_status_history_to_check
    CHECK (to_status IN ('available','held','reserved','booked','sold','blocked','unavailable')),
  CONSTRAINT inventory_unit_status_history_from_check
    CHECK (from_status IS NULL OR from_status IN ('available','held','reserved','booked','sold','blocked','unavailable')),
  CONSTRAINT inventory_unit_status_history_metadata_check CHECK (jsonb_typeof(metadata)='object')
);
CREATE INDEX IF NOT EXISTS inventory_unit_status_history_unit_idx
  ON inventory_unit_status_history (unit_id, created_at DESC, history_id DESC);

CREATE TABLE IF NOT EXISTS inventory_holds (
  hold_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES inventory_units(unit_id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(lead_id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES opportunities(opportunity_id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  released_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_holds_status_check CHECK (status IN ('active','released','expired','converted','cancelled')),
  CONSTRAINT inventory_holds_reference_check CHECK (lead_id IS NOT NULL OR opportunity_id IS NOT NULL),
  CONSTRAINT inventory_holds_expiry_check CHECK (expires_at>created_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_holds_active_unit_uidx
  ON inventory_holds (unit_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS inventory_holds_expiry_idx
  ON inventory_holds (expires_at, unit_id) WHERE status='active';

CREATE TABLE IF NOT EXISTS inventory_reservations (
  reservation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES inventory_units(unit_id) ON DELETE RESTRICT,
  opportunity_id UUID NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE RESTRICT,
  hold_id UUID REFERENCES inventory_holds(hold_id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  reservation_amount NUMERIC(16,2),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  expires_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  cancelled_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_reservations_status_check CHECK (status IN ('active','converted','cancelled','expired')),
  CONSTRAINT inventory_reservations_amount_check CHECK (reservation_amount IS NULL OR reservation_amount>=0),
  CONSTRAINT inventory_reservations_currency_check CHECK (currency ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_reservations_active_unit_uidx
  ON inventory_reservations (unit_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS inventory_reservations_opportunity_idx
  ON inventory_reservations (opportunity_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_import_jobs (
  import_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  source VARCHAR(30) NOT NULL DEFAULT 'csv',
  file_name VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  idempotency_key VARCHAR(200),
  total_rows INTEGER NOT NULL DEFAULT 0,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  succeeded_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  mapping JSONB NOT NULL DEFAULT '{}'::JSONB,
  error_summary TEXT,
  created_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_import_jobs_source_check CHECK (source IN ('csv','xlsx','api','generator')),
  CONSTRAINT inventory_import_jobs_status_check CHECK (status IN ('pending','validating','processing','completed','partial','failed','cancelled')),
  CONSTRAINT inventory_import_jobs_counts_check CHECK (
    total_rows>=0 AND processed_rows>=0 AND succeeded_rows>=0 AND failed_rows>=0
  ),
  CONSTRAINT inventory_import_jobs_mapping_check CHECK (jsonb_typeof(mapping)='object')
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_import_jobs_idempotency_uidx
  ON inventory_import_jobs (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_import_jobs_project_idx
  ON inventory_import_jobs (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_import_rows (
  import_row_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES inventory_import_jobs(import_id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw_data JSONB NOT NULL,
  normalized_data JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  unit_id UUID REFERENCES inventory_units(unit_id) ON DELETE SET NULL,
  errors JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_import_rows_number_check CHECK (row_number>0),
  CONSTRAINT inventory_import_rows_raw_check CHECK (jsonb_typeof(raw_data)='object'),
  CONSTRAINT inventory_import_rows_normalized_check CHECK (normalized_data IS NULL OR jsonb_typeof(normalized_data)='object'),
  CONSTRAINT inventory_import_rows_status_check CHECK (status IN ('pending','valid','imported','failed')),
  CONSTRAINT inventory_import_rows_errors_check CHECK (jsonb_typeof(errors)='array'),
  UNIQUE (import_id, row_number)
);
CREATE INDEX IF NOT EXISTS inventory_import_rows_status_idx
  ON inventory_import_rows (import_id, status, row_number);

COMMIT;
