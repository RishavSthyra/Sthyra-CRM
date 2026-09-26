# Inventory backend

All user-facing endpoints require the normal CRM session and enforce company and
project access. The maintenance endpoint uses `Authorization: Bearer $CRON_SECRET`.

## Catalogue and structure

- `GET|POST /api/inventory/asset-types`
- `PATCH /api/inventory/asset-types/{assetTypeId}`
- `GET|POST /api/inventory/nodes?project_id={projectId}`
- `PATCH /api/inventory/nodes/{nodeId}`
- `GET|POST /api/inventory/unit-types?project_id={projectId}`
- `PATCH /api/inventory/unit-types/{unitTypeId}`
- `PUT /api/inventory/unit-types/{unitTypeId}/floor-plans`
- `GET|POST /api/inventory/floor-plans?project_id={projectId}`
- `PATCH /api/inventory/floor-plans/{floorPlanId}`
- `POST /api/inventory/floor-plans/{floorPlanId}/assets`
- `DELETE /api/inventory/floor-plans/{floorPlanId}/assets/{assetId}`
- `GET|POST /api/inventory/attributes?project_id={projectId}`
- `PATCH /api/inventory/attributes/{attributeId}`

`project_inventory_nodes` is an unrestricted parent-child hierarchy. Node kinds
such as `phase`, `tower`, `wing`, `floor`, `villa_cluster`, `street`, and `block`
are conventions rather than a closed enum.

## Units and availability

- `GET|POST /api/inventory/units`
- `GET|PATCH|DELETE /api/inventory/units/{unitId}`
- `GET /api/inventory/units/{unitId}/history`
- `POST /api/inventory/units/{unitId}/hold`
- `POST /api/inventory/units/{unitId}/release`
- `POST /api/inventory/units/{unitId}/reserve`
- `POST /api/inventory/units/{unitId}/change-status`
- `GET /api/inventory/holds?project_id={projectId}`
- `GET /api/inventory/reservations?project_id={projectId}`
- `POST /api/inventory/reservations/{reservationId}/cancel`
- `POST /api/inventory/reservations/{reservationId}/convert`
- `GET /api/inventory/summary?project_id={projectId}`

State transitions are controlled by commands:

```text
available -> held -> reserved -> booked -> sold
    |          |         |
    +----------+---------+-> blocked/unavailable (controlled transitions)
```

The unit `version` field provides optimistic locking for edits. Active holds and
reservations have partial unique indexes, preventing double allocation even when
two requests race.

## Pricing

- `GET|POST /api/inventory/price-books?project_id={projectId}`
- `PATCH /api/inventory/price-books/{priceBookId}`
- `GET|POST /api/inventory/prices?price_book_id={priceBookId}`
- `PATCH|DELETE /api/inventory/prices/{priceEntryId}`

Price entries target exactly one unit type or one individual unit. Their
`components` object can store floor-rise, preferred-location, parking, tax, and
other project-specific components.

## Bulk onboarding

### Import

`POST /api/inventory/imports` accepts up to 5,000 normalized rows. A frontend can
parse CSV or XLSX, show a mapping preview, and submit the mapped rows.

```json
{
  "project_id": 1,
  "source": "csv",
  "file_name": "tower-a.csv",
  "idempotency_key": "tower-a-2026-09-28",
  "upsert": true,
  "rows": [
    {
      "unit_code": "A-0501",
      "external_unit_key": "erp-10051",
      "unit_type_code": "2BHK-A",
      "node_code": "A-F05",
      "area_sqft": 1120,
      "orientation": "East"
    }
  ]
}
```

- `GET /api/inventory/imports?project_id={projectId}` lists jobs.
- `GET /api/inventory/imports/{importId}` returns per-row results and errors.

### Generate repetitive inventory

`POST /api/inventory/generate` supports `series` for villas/plots and `stacked`
for tower inventory.

```json
{
  "project_id": 1,
  "mode": "stacked",
  "building_kind": "tower",
  "building_code": "TOWER-A",
  "building_name": "Tower A",
  "level_kind": "floor",
  "level_count": 30,
  "level_start": 1,
  "unit_code_prefix": "A-",
  "number_padding": 2,
  "stacks": [
    { "stack_code": "01", "unit_type_id": "uuid" },
    { "stack_code": "02", "unit_type_id": "uuid" }
  ]
}
```

## Maintenance

Call `POST /api/inventory/maintenance/expire` from the existing cron worker
schedule. It expires stale holds and reservations and returns affected units to
`available` with an auditable status-history record.
