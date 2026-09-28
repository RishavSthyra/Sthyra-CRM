# Supabase cutover

Use a new Supabase project for the first rehearsal. Do not point the production
application at Supabase until the restore, RLS migration, and isolation checks
all pass.

## 1. Prepare the source database

Run all normal application migrations first, followed by:

```bash
psql "$LOCAL_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f database/migrations/20261003_prepare_tenant_keys.sql
```

This migration is already applied to the current local development database.
It adds and backfills the tenant keys that must be present in the dump.

## 2. Dump and restore

Use a `pg_dump` client at least as new as the source PostgreSQL server. Follow
Supabase's Postgres migration guide and use `--no-owner --no-privileges`. The
application schema and data are in `public`; do not copy a local `auth` schema
over Supabase's managed Auth schema.

Use the Supabase **Session pooler** or direct connection for the migration.
The runtime application can use the **Transaction pooler** with
`DATABASE_POOL_MAX=1`.

## 3. Apply the Supabase-only foundation

After the public schema and data have been restored, run:

```bash
psql "$SUPABASE_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f database/migrations/20261003_supabase_multitenancy_foundation.sql
```

This links CRM identities to `auth.users`, creates workspace memberships,
enables RLS on every public table, installs explicit tenant policies, revokes
all browser-facing table access, and makes future tables fail closed. The
Next.js backend assumes a dedicated `sthyra_app_server` NOLOGIN role inside
each tenant-scoped transaction; `anon` and `authenticated` cannot query CRM
tables through the Data API.

Existing local users are linked lazily: their first successful password login
creates the corresponding Supabase Auth identity and removes the legacy CRM
password hash.

## 4. Configure Auth

In Supabase Auth settings:

- Set the Site URL to the deployed application URL.
- Allow the deployed and local `/api/auth/callback` URLs.
- Enable Google and register Supabase's provider callback URL in Google Cloud.
- Require at least 12 password characters plus uppercase, lowercase, number,
  and symbol. Enable leaked-password protection when the plan supports it.
- Keep email confirmation enabled for production signup.

In Supabase API settings, disable the Data API if this project does not need it,
or expose a separate empty schema instead of `public`. The migration already
revokes `public` table privileges from `anon` and `authenticated`, but disabling
the unused endpoint removes another attack surface. Supabase Auth continues to
work when the database Data API is disabled.

## 5. Configure application secrets

Copy the required keys into the deployment environment using `.env.example` as
the source of truth. At minimum configure:

- `APP_URL`
- `DATABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_SECRET`
- `LEAD_INTAKE_SECRET`
- `CRON_SECRET`

Never expose the database URL or service-role key through a `NEXT_PUBLIC_`
variable. For full TLS verification, download the Supabase database CA
certificate and set its base64 value as `DATABASE_SSL_CA_BASE64`.

## 6. Cutover checks

Before adding real tenants:

1. Create two test workspaces with different users.
2. Create a lead, contact, opportunity, appointment, and inventory unit in each.
3. Verify each user sees only their own workspace through both the UI and API.
4. Verify both signed-out and signed-in Data API requests cannot read public
   CRM tables with the publishable key.
5. Test email signup confirmation, Google signup, login, password reset, email
   change confirmation, logout, and the first login of one restored legacy user.
6. Run the notification, email, inventory-expiry, lead-intake, and telephony
   endpoints only with their configured secrets.
7. Run `ANALYZE` after the restore and compare critical table row counts with the
   source database.
