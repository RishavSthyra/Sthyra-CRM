# Aadhya Serene MongoDB migration

This runbook migrates the legacy MongoDB archive into the Abhigna
Constructions workspace and the Aadhya Serene project.

The importer is intentionally historical: it writes owners as `NULL` and does
not run routing or SLA automation. Legacy owner values remain available in the
raw intake payload and `leads.qualification_data` for a later reconciliation.

## Data policy

- All legacy notification records belong to the Aadhya Serene project.
- `metadata.businessName = Abhigna Constructions` is the parent-company brand,
  not a second project.
- Phone numbers are normalized to Indian E.164 format.
- Repeated submissions for the same normalized phone become one contact and
  one Aadhya Serene lead.
- Every original submission is retained as a processed `lead_intake_events`
  record and an attribution record.
- Calls, remarks, lifecycle events and WhatsApp messages remain separate,
  linked records.
- Records without a usable phone are reported as quarantined and are not
  imported automatically.

## Prerequisites

1. Create the `Abhigna Constructions` company in the CRM.
2. Create the `Aadhya Serene` project under that company.
3. Ensure the project has an active initial lead stage.
4. Apply the communication and import-tracking migration:

   ```bash
   psql "$DATABASE_URL" \
     -v ON_ERROR_STOP=1 \
     -f database/migrations/20261011_create_communications_and_legacy_imports.sql
   ```

5. Install MongoDB Database Tools (`mongorestore` and `mongoexport`) and
   `mongosh`. A local MongoDB instance must be available during extraction.

## Dry run

Dry run is the default and never writes to PostgreSQL:

```bash
npm run migrate:aadhya -- \
  --archive /absolute/path/to/AadhyaSerene.archive
```

The report must be reviewed before proceeding. For the archive inspected on
2026-10-06, the expected reconciliation is:

| Entity | Expected |
|---|---:|
| Original submissions | 1,014 |
| Valid submissions | 1,011 |
| Consolidated leads | 811 |
| Repeated submissions | 200 |
| Quarantined submissions | 3 |
| Calls | 1,848 |
| Sales remarks | 41 |
| Lifecycle events | 270 |
| Metadata activities | 55 |
| WhatsApp conversations | 700 |
| WhatsApp messages | 3,182 |
| Telephony webhook events | 19 |

## Commit

After confirming the target and dry-run totals:

```bash
npm run migrate:aadhya -- \
  --archive /absolute/path/to/AadhyaSerene.archive \
  --company "Abhigna Constructions" \
  --project "Aadhya Serene" \
  --commit
```

The commit runs in one PostgreSQL transaction. A failure rolls back the entire
run. Stable legacy mappings and intake idempotency keys make a rerun safe.

## Post-import checks

1. Compare `legacy_import_runs.stats` with the dry-run report.
2. Confirm 811 imported lead mappings and 1,014 intake-event mappings.
3. Review the three quarantined MongoDB IDs from the dry-run report.
4. Sample leads from each source and compare calls, notes and WhatsApp history.
5. Create Murugesh and Nitin Reddy in the CRM.
6. Run a separate, reviewed owner-reconciliation operation.
7. Enable routing and SLA only for new leads after the historical import.

