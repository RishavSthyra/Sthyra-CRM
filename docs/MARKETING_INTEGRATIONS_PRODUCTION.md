# Marketing acquisition and attribution

This module connects landing pages, Google lead forms, partner webhooks, CRM
lead routing, attribution, and Google Ads conversion feedback. It is tenant and
project scoped. Public clients receive only a form's random public key; company,
project, source, campaign, routing defaults, and provider credentials are always
resolved on the server.

## 1. Deploy the database and application

Apply the normal migrations in order. On an existing Supabase deployment, the
new marketing schema is installed with:

```bash
psql "$SUPABASE_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f database/migrations/20261005_create_marketing_attribution.sql
```

Add these production variables to Vercel and redeploy:

```text
APP_URL=https://crm.example.com
MARKETING_HASH_SECRET=<at-least-32-random-characters>
INTEGRATION_TOKEN_ENCRYPTION_KEY=<32-random-bytes-as-base64>
GOOGLE_MARKETING_CLIENT_ID=<google-oauth-client-id>
GOOGLE_MARKETING_CLIENT_SECRET=<google-oauth-client-secret>
GOOGLE_MARKETING_REDIRECT_URI=https://crm.example.com/api/marketing/google/callback
CRON_SECRET=<at-least-32-random-characters>
```

Generate independent secrets:

```bash
openssl rand -base64 32
```

`APP_URL` is required for the OAuth callback and must be the final HTTPS
origin, with no path or trailing slash. Never prefix the token encryption key,
hash secret, database URL, or OAuth secret with `NEXT_PUBLIC_`.

Vercel reads `vercel.json` and calls the conversion worker every ten minutes.
Vercel automatically sends `Authorization: Bearer $CRON_SECRET` to cron routes.
For self-hosting, call this endpoint on the same schedule:

```bash
curl --fail --request POST \
  --header "Authorization: Bearer $CRON_SECRET" \
  https://crm.example.com/api/marketing/conversion-jobs/process
```

For a self-hosted Next.js production process:

```bash
npm ci
npm run build
npm run start
```

## 2. Prepare CRM attribution records

In **Settings → Lead sources**, create stable sources such as:

- Google Ads (`paid_search`)
- Website / organic (`website`)
- Channel partner (`partner`)
- Property portal (`portal`)
- Billboard / QR / inbound call (`offline`)
- Instagram / Meta (`paid_social`)

Create individual campaigns under those sources. Do not create a separate lead
source for every ad. Source answers *where the demand came from*; campaign
answers *which marketing initiative generated it*; touchpoints preserve the
individual page view, click, form submission, or provider event.

## 3. Start a landing-page integration

1. Open **Marketing → Forms & webhooks → New endpoint**.
2. Choose `Website form`, a project, lead source, campaign, and every exact
   allowed website origin. An origin includes the scheme and host, for example
   `https://homes.example.com`. Wildcards such as `*.example.com` are supported.
3. Create the endpoint and copy the one-time secret to a password manager. The
   secret is needed only for server-to-server submissions; browser forms are
   protected with the origin allow-list.
4. Add the generated script to the landing page and mark the form:

```html
<script
  src="https://crm.example.com/sthyra-marketing.js"
  data-form-key="FORM_PUBLIC_KEY"
  defer
></script>

<form data-sthyra-form>
  <input name="first_name" required>
  <input name="last_name">
  <input name="email" type="email">
  <input name="phone_number" required>
  <input name="preferred_location">
  <input name="preferred_config">
  <button type="submit">Request details</button>
</form>
```

The script stores a random first-party visitor ID and per-tab session ID. It
captures UTM values plus `gclid`, `gbraid`, `wbraid`, and `fbclid`, records the
page view, and submits the form to the mapped tenant/project. Listen for
`sthyra:submitted` and `sthyra:error` on the form to show the site's success or
error UI.

For a backend-owned form, POST JSON to the generated submission URL and send:

```text
X-Sthyra-Form-Secret: <one-time submission secret>
Content-Type: application/json
```

Use a stable, unique `event_id` for retries. Repeating it is safe and returns the
existing intake result.

## 4. Start a Google native lead-form integration

1. In Google Ads, note the lead form asset ID.
2. In **Marketing → Forms & webhooks**, create a `Google lead form` endpoint,
   select the project/source/campaign, and enter that form ID.
3. Copy the generated webhook URL and one-time `Google key`.
4. In the Google Ads lead form delivery settings, paste the webhook URL and use
   the generated Google key as the webhook key.
5. Send Google's test payload. A successful test returns HTTP 200. The Google
   `lead_id` is the idempotency key, so provider retries cannot create duplicates.

The webhook validates the key with constant-time comparison, checks the Google
form ID, rate limits by a keyed digest, ignores unknown provider fields, and
passes the normalized contact and lead through the normal CRM intake/routing
pipeline.

## 5. Send CRM outcomes back to Google Ads

In Google Cloud:

1. Enable the **Data Manager API**.
2. Configure the OAuth consent screen for the CRM's production domain.
3. Create a Web application OAuth client.
4. Add the exact authorized redirect URI:
   `https://crm.example.com/api/marketing/google/callback`.

In Google Ads, create or identify conversion actions for the milestones you
want bidding to optimize. For offline lead conversions, use conversion actions
that accept uploaded click conversions. Copy each numeric conversion action ID.

Then in the CRM:

1. Open **Marketing → Integrations → Add Google Ads**.
2. Enter the conversion customer (operating account) ID. If access is through a
   manager account, enter its ID as the login account.
3. Map action IDs for `Lead qualified`, `Site visit completed`, and
   `Booking confirmed`, and `Opportunity won`.
4. Save, click **Connect Google**, and approve the Data Manager scope.

Tracked leads retain their Google click ID. When one reaches a mapped CRM
milestone, the transaction is queued once and delivered asynchronously. Failed
events back off automatically and appear under **Marketing → Conversions** with
their provider diagnostic and a manual Retry action.

## 6. Production acceptance test

Perform this once for each production project and acquisition provider:

1. Open the landing page with test UTMs and a Google test click identifier.
2. Confirm a `page view` appears under **Marketing → Touchpoints**.
3. Submit the form and verify exactly one contact and lead are created with the
   expected project, source, campaign, owner, and routing history.
4. Retry the identical submission and verify no second lead is created.
5. Qualify the lead, complete a site visit, and confirm a booking.
6. Verify the conversion jobs move from `queued` to `sent`. For intentional test
   failures, verify the Google error is visible and Retry works after correction.
7. Submit from an unlisted origin and with an incorrect Google key; both must be
   rejected.
8. Repeat while signed into a second tenant and verify neither tenant can read or
   edit the other's forms, touchpoints, integrations, credentials, or jobs.

Do not judge Google Ads reporting immediately after a successful API request;
provider reporting and diagnostics can lag behind ingestion. The CRM's `sent`
state means Google accepted the request and returned a request ID.
