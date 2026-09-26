export type Project = {
  project_id: number;
  project_code: string;
  project_name: string;
  project_status: string;
  project_type: string;
};

export type ProjectContext = {
  company: { company_id: number; company_name: string };
  role_key: string;
  can_view_all_projects: boolean;
  projects: Project[];
};

export type AssetType = {
  asset_type_id: string;
  type_key: string;
  display_name: string;
  description: string | null;
  icon_key: string | null;
  is_system: boolean;
};

export type FloorPlanAsset = {
  asset_id?: string;
  asset_kind: string;
  asset_url: string;
  file_name?: string | null;
  mime_type?: string | null;
};

export type FloorPlan = {
  floor_plan_id: string;
  plan_code: string;
  plan_name: string;
  version: number;
  description: string | null;
  dimensions: Record<string, unknown>;
  is_active: boolean;
  assets: FloorPlanAsset[];
};

export type UnitType = {
  unit_type_id: string;
  asset_type_id: string;
  asset_type_key: string;
  asset_type_name: string;
  type_code: string;
  type_name: string;
  configuration: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  balconies: number | null;
  carpet_area_sqft: number | string | null;
  built_up_area_sqft: number | string | null;
  saleable_area_sqft: number | string | null;
  base_price: number | string | null;
  currency: string;
  specifications: Record<string, unknown>;
  is_active: boolean;
  floor_plans: Array<{
    floor_plan_id: string;
    plan_code: string;
    plan_name: string;
    version: number;
    plan_role: string;
    display_order: number;
  }>;
};

export type InventoryNode = {
  node_id: string;
  parent_node_id: string | null;
  node_kind: string;
  node_code: string;
  node_name: string;
  sort_order: number;
  depth: number;
  is_active: boolean;
};

export type InventoryStatus =
  | "available"
  | "held"
  | "reserved"
  | "booked"
  | "sold"
  | "blocked"
  | "unavailable";

export type InventoryUnit = {
  unit_id: string;
  project_id: number;
  node_id: string | null;
  unit_type_id: string;
  unit_code: string;
  unit_name: string | null;
  external_unit_key: string | null;
  orientation: string | null;
  area_sqft: number | string | null;
  price_override: number | string | null;
  currency: string;
  metadata: Record<string, unknown>;
  type_specifications?: Record<string, unknown>;
  effective_price?: number | string | null;
  effective_price_currency?: string | null;
  effective_price_source?: EffectiveInventoryPrice["source"] | null;
  status: InventoryStatus;
  version: number;
  updated_at: string;
  node_kind: string | null;
  node_code: string | null;
  node_name: string | null;
  type_code: string;
  type_name: string;
  configuration: string | null;
  carpet_area_sqft: number | string | null;
  built_up_area_sqft: number | string | null;
  saleable_area_sqft: number | string | null;
  base_price: number | string | null;
  asset_type_key: string;
  asset_type_name: string;
};

export type InventoryUnitDetail = InventoryUnit & {
  floor_plans: FloorPlan[];
  prices: Array<{
    price_entry_id: string;
    price_book_name: string;
    base_amount: number | string;
    currency: string;
    components: Record<string, unknown>;
  }>;
  active_hold: {
    hold_id: string;
    lead_id: string;
    opportunity_id: string | null;
    reason: string | null;
    expires_at: string;
  } | null;
  active_reservation: {
    reservation_id: string;
    opportunity_id: string;
    reservation_amount: number | string | null;
    currency: string;
    expires_at: string | null;
  } | null;
};

export type InventorySummary = {
  project_id: number;
  node_count: number;
  unit_type_count: number;
  floor_plan_count: number;
  unit_count: number;
  status_counts: Array<{ status: InventoryStatus; count: number }>;
  asset_type_counts: Array<{
    asset_type_id: string;
    type_key: string;
    display_name: string;
    unit_count: number;
  }>;
  holds: { active_holds: number; expiring_within_24_hours: number };
};

export type ImportJob = {
  import_id: string;
  source: string;
  file_name: string | null;
  status: string;
  total_rows: number;
  processed_rows: number;
  succeeded_rows: number;
  failed_rows: number;
  created_at: string;
  completed_at: string | null;
};

export type PriceBook = {
  price_book_id: string;
  price_book_code: string;
  price_book_name: string;
  currency: string;
  valid_from: string | null;
  valid_until: string | null;
  is_default: boolean;
  is_active: boolean;
  entry_count: number;
};

export type PriceEntry = {
  price_entry_id: string;
  price_book_id: string;
  unit_type_id: string | null;
  unit_id: string | null;
  base_amount: number | string;
  components: Record<string, unknown>;
  valid_from: string | null;
  valid_until: string | null;
  source: "manual" | "unit_type_base";
  type_code: string | null;
  type_name: string | null;
  unit_code: string | null;
  unit_name: string | null;
  created_at: string;
  updated_at: string;
};

export type InventoryAttributeDefinition = {
  definition_id: string;
  project_id: number;
  applies_to: "unit_type" | "unit";
  attribute_key: string;
  label: string;
  data_type: "text" | "number" | "boolean" | "date" | "select" | "multi_select";
  is_required: boolean;
  options: unknown[];
  display_order: number;
  is_active: boolean;
};

export type EffectiveInventoryPrice = {
  source:
    | "unit_override"
    | "unit_price_book"
    | "unit_type_base"
    | "manual"
    | "unit_type_fallback";
  target: "unit" | "unit_type";
  base_amount: number | string;
  components: Record<string, unknown>;
  total_amount: number;
  currency: string;
  as_of: string;
  price_book_id?: string;
  price_book_code?: string;
  price_book_name?: string;
};

export type InventoryDialogKind =
  | "unit"
  | "unitType"
  | "floorPlan"
  | "node"
  | "generate"
  | "import"
  | "priceBook";
