import { NextRequest, NextResponse } from "next/server";
import { adminPool } from "@/lib/db";
import { validGoogleMarketingAccessToken } from "@/lib/googleMarketing";
import { hasValidBearerSecret } from "@/lib/integrationAuth";

function authorized(request: NextRequest) {
  return hasValidBearerSecret(request, process.env.CRON_SECRET);
}

async function processOne() {
  const client = await adminPool.connect();
  let job: Record<string, unknown> | null = null;
  try {
    await client.query("BEGIN");
    const claimed = await client.query(
      `WITH candidate AS (
         SELECT conversion_job_id
         FROM marketing_conversion_jobs
         WHERE status IN ('queued','failed')
           AND attempt_count < max_attempts
           AND next_attempt_at <= CURRENT_TIMESTAMP
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE marketing_conversion_jobs job
       SET status='processing', attempt_count=attempt_count+1,
           last_error=NULL, updated_at=CURRENT_TIMESTAMP
       FROM candidate
       WHERE job.conversion_job_id=candidate.conversion_job_id
       RETURNING job.*`,
    );
    if (!claimed.rowCount) {
      await client.query("COMMIT");
      return null;
    }
    const loaded = await client.query(
      `SELECT job.*,
              integration.provider, integration.status AS integration_status,
              integration.external_account_id, integration.login_account_id,
              integration.access_token_ciphertext,
              integration.refresh_token_ciphertext,
              integration.access_token_expires_at, integration.settings,
              touchpoint.gclid, touchpoint.gbraid, touchpoint.wbraid,
              touchpoint.ad_user_data_consent,
              touchpoint.ad_personalization_consent
       FROM marketing_conversion_jobs job
       JOIN marketing_integrations integration
         ON integration.integration_id=job.integration_id
       LEFT JOIN marketing_touchpoints touchpoint
         ON touchpoint.touchpoint_id=job.touchpoint_id
       WHERE job.conversion_job_id=$1`,
      [claimed.rows[0].conversion_job_id],
    );
    job = loaded.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  if (!job) return null;

  try {
    if (job.provider !== "google_data_manager" || job.integration_status !== "connected") {
      throw new Error("Google Data Manager integration is not connected");
    }
    const requestPayload = (job.request_payload ?? {}) as Record<string, unknown>;
    const conversionActionId = String(requestPayload.conversion_action_id ?? "").replace(/\D/g, "");
    if (!conversionActionId) throw new Error("No conversion action is configured for this event");
    const adIdentifiers = Object.fromEntries(
      (["gclid", "gbraid", "wbraid"] as const)
        .filter((field) => typeof job?.[field] === "string" && String(job[field]).trim())
        .map((field) => [field, job?.[field]]),
    );
    if (!Object.keys(adIdentifiers).length) {
      throw new Error("No Google click identifier is linked to this conversion");
    }
    const operatingAccount = String(job.external_account_id ?? "").replace(/\D/g, "");
    const loginAccount = String(job.login_account_id ?? "").replace(/\D/g, "");
    if (!operatingAccount) throw new Error("Google Ads operating account is missing");
    const destination: Record<string, unknown> = {
      reference: "google_ads_conversion",
      operatingAccount: { accountType: "GOOGLE_ADS", accountId: operatingAccount },
      productDestinationId: conversionActionId,
    };
    if (loginAccount) destination.loginAccount = { accountType: "GOOGLE_ADS", accountId: loginAccount };
    const event: Record<string, unknown> = {
      destinationReferences: ["google_ads_conversion"],
      transactionId: job.transaction_id,
      eventTimestamp: new Date(String(job.event_timestamp)).toISOString(),
      eventSource: "OTHER",
      adIdentifiers,
    };
    if (job.conversion_value !== null && job.conversion_value !== undefined) {
      event.conversionValue = Number(job.conversion_value);
      if (job.currency) event.currency = job.currency;
    }
    const token = await validGoogleMarketingAccessToken(job);
    const response = await fetch("https://datamanager.googleapis.com/v1/events:ingest", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ destinations: [destination], events: [event] }),
      cache: "no-store",
    });
    const raw = await response.text();
    let providerBody: Record<string, unknown> = {};
    try { providerBody = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { providerBody = { response: raw.slice(0, 2000) }; }
    if (!response.ok) {
      throw new Error(`Google Data Manager ${response.status}: ${String((providerBody.error as Record<string, unknown> | undefined)?.message ?? raw).slice(0, 1000)}`);
    }
    await adminPool.query(
      `UPDATE marketing_conversion_jobs
       SET status='sent', provider_response=$2::jsonb,
           provider_request_id=$3, sent_at=CURRENT_TIMESTAMP,
           next_attempt_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
       WHERE conversion_job_id=$1`,
      [job.conversion_job_id, JSON.stringify(providerBody), providerBody.requestId ?? null],
    );
    await adminPool.query(
      `UPDATE marketing_integrations
       SET last_synced_at=CURRENT_TIMESTAMP, last_error=NULL,
           updated_at=CURRENT_TIMESTAMP
       WHERE integration_id=$1`,
      [job.integration_id],
    );
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversion delivery failed";
    await adminPool.query(
      `UPDATE marketing_conversion_jobs
       SET status='failed', last_error=$2,
           next_attempt_at=CURRENT_TIMESTAMP + (POWER(2,LEAST(attempt_count,8)) * INTERVAL '5 minutes'),
           updated_at=CURRENT_TIMESTAMP
       WHERE conversion_job_id=$1`,
      [job.conversion_job_id, message.slice(0, 5000)],
    );
    await adminPool.query(
      `UPDATE marketing_integrations
       SET last_error=$2, updated_at=CURRENT_TIMESTAMP
       WHERE integration_id=$1`,
      [job.integration_id, message.slice(0, 5000)],
    );
    console.error("Marketing conversion delivery failed", error);
    return { sent: false };
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "Conversion jobs are not configured" }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const results = { sent: 0, failed: 0 };
  for (let index = 0; index < 50; index += 1) {
    const result = await processOne();
    if (!result) break;
    if (result.sent) results.sent += 1;
    else results.failed += 1;
  }
  await adminPool.query(
    "DELETE FROM marketing_ingestion_limits WHERE bucket_started_at < CURRENT_TIMESTAMP - INTERVAL '1 day'",
  );
  return NextResponse.json(results);
}

export async function GET(request: NextRequest) {
  return POST(request);
}

