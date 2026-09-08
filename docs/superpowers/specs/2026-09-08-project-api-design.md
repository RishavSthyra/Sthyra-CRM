# Project API Design

Date: 2026-09-08

## Scope

Complete the Project API module against the existing PostgreSQL `projects` table. The module covers collection listing and creation, individual retrieval and partial updates, plus explicit activation and deactivation. It does not add archive or restore behavior because the table has no `archived_at` column.

Authentication, RBAC, phases, towers, inventory synchronization, and project-level configuration are outside this increment.

## Chosen Approach

Use flat REST routes and external business codes. API clients send `company_code` and `region_code`; the server resolves these values to `company_id` and `region_id`, which remain the authoritative foreign keys stored in `projects`.

This is preferred over requiring database IDs because business codes are stable and understandable to API consumers. It is also preferred over company-nested routes because a project belongs to both a company and a region and must support cross-company administrative filtering.

The API will follow the response, validation, pagination, and action-route conventions already established by the Region module.

## Routes

### `GET /api/projects`

Return active projects by default. Supported query parameters:

- `page`: positive integer, default `1`
- `limit`: positive integer, default `50`, maximum `100`
- `search`: searches project code, project name, address, and RERA number
- `companyCode`: filters through the related company code
- `regionCode`: filters through the related region code
- `status`: one of the database-supported project statuses
- `type`: one of the database-supported project types
- `includeInactive`: `true` or `false`, default `false`

The response contains a `projects` array and pagination metadata. Each result includes company and region identification fields so clients do not need an additional lookup merely to display the project.

### `POST /api/projects`

Create a project. The body accepts:

- Required: `company_code`, `region_code`, `project_code`, `project_name`
- Optional with database defaults: `project_status`, `project_type`, `is_active`
- Optional nullable fields: `project_acres`, `start_date`, `expected_completion_date`, `address`, `postal_code`, `latitude`, `longitude`, `rera_number`

The API never accepts `project_id`; PostgreSQL generates it through the existing identity column. Company and region codes are resolved before insertion. The created project is returned with status `201`.

### `GET /api/projects/{projectId}`

Return one project, including inactive projects. Invalid IDs return `400`; missing projects return `404`.

### `PATCH /api/projects/{projectId}`

Partially update mutable project fields. `company_code` and `region_code` may be supplied to move a project to another valid company or region. `project_id`, timestamps, and raw foreign-key IDs are not accepted. Empty bodies and unknown fields are rejected.

### `POST /api/projects/{projectId}/activate`

Set `is_active` to `true`, update `updated_at`, and return the project.

### `POST /api/projects/{projectId}/deactivate`

Set `is_active` to `false`, update `updated_at`, and return the project. Deactivated projects are omitted from the default collection response.

## Validation and Database Rules

Validation must match the live table:

- `project_code`: non-empty string, maximum 20 characters
- `project_name`: non-empty string, maximum 200 characters
- `project_status`: `planning`, `launched`, `under_construction`, `completed`, or `on_hold`
- `project_type`: `residential`, `commercial`, or `mix_use`
- `project_acres`: finite number greater than zero when supplied
- `latitude`: finite number from `-90` through `90`
- `longitude`: finite number from `-180` through `180`
- `expected_completion_date`: not earlier than `start_date` when both are supplied
- `postal_code`: maximum 20 characters
- `rera_number`: maximum 200 characters
- `is_active`: boolean

Codes are trimmed and normalized to uppercase. Project codes are unique within a company. A database-level unique index on `(company_id, lower(project_code))` is required so duplicate protection remains safe under concurrent requests.

All values from clients use SQL parameters. Dynamic update column names come only from an internal allowlist.

## Responses and Errors

- `200`: successful read, update, activation, or deactivation
- `201`: successful creation
- `400`: malformed JSON, malformed query parameters, or invalid project ID
- `404`: project, company code, or region code not found
- `409`: duplicate project code within the company
- `422`: field validation failure
- `500`: unexpected database or server failure

Server errors are logged without exposing SQL details or credentials in API responses.

## Internal Structure

- `lib/projects.ts`: shared column list, types, validation, serialization, ID parsing, and database-error helpers
- `app/api/projects/route.ts`: collection listing and creation
- `app/api/projects/[projectid]/route.ts`: individual retrieval and partial updates
- `app/api/projects/[projectid]/activate/route.ts`: activation action
- `app/api/projects/[projectid]/deactivate/route.ts`: deactivation action

## Verification

Verification includes TypeScript, ESLint, a production build, and live HTTP smoke tests against PostgreSQL. The positive lifecycle test creates temporary company, region, and project records; exercises list, create, retrieve, duplicate rejection, patch, deactivate, activate, and filtering; then removes only those temporary records.
