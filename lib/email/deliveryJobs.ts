import pool from "@/lib/db";
import { recordActivity } from "@/lib/activities";
import type { EmailAttachmentInput } from "@/lib/communications";
import {
  ConnectedMailbox,
  deliverWithConnectedMailbox,
} from "@/lib/email/providerDelivery";

type ClaimedJob = {
  email_delivery_job_id: string;
  email_id: string;
  attempts: number;
  max_attempts: number;
};

export type DeliveryJobResult = {
  jobId: string;
  emailId: string;
  sent: boolean;
  error?: string;
};

async function claimJob(jobId?: string): Promise<ClaimedJob | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT email_delivery_job_id, email_id, attempts, max_attempts
       FROM email_delivery_jobs
       WHERE (
         (status IN ('queued', 'retrying') AND next_attempt_at <= CURRENT_TIMESTAMP)
         OR (status='processing' AND locked_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes')
       )
         ${jobId ? "AND email_delivery_job_id=$1" : ""}
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      jobId ? [jobId] : [],
    );
    if (!result.rowCount) {
      await client.query("COMMIT");
      return null;
    }
    const job = result.rows[0] as ClaimedJob;
    await client.query(
      `UPDATE email_delivery_jobs
       SET status='processing', attempts=attempts+1, locked_at=CURRENT_TIMESTAMP,
           updated_at=CURRENT_TIMESTAMP
       WHERE email_delivery_job_id=$1`,
      [job.email_delivery_job_id],
    );
    await client.query(
      "UPDATE emails SET status='sending', updated_at=CURRENT_TIMESTAMP WHERE email_id=$1",
      [job.email_id],
    );
    await client.query("COMMIT");
    return { ...job, attempts: Number(job.attempts) + 1 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function processEmailDeliveryJob(
  requestedJobId?: string,
): Promise<DeliveryJobResult | null> {
  const job = await claimJob(requestedJobId);
  if (!job) return null;
  try {
    const result = await pool.query(
      `SELECT e.*, ec.provider, ec.email_address,
              ec.email_connection_id, ec.display_name,
              ec.access_token_ciphertext, ec.refresh_token_ciphertext,
              ec.access_token_expires_at, ec.status AS connection_status
       FROM emails e
       JOIN email_connections ec ON ec.email_connection_id=e.email_connection_id
       WHERE e.email_id=$1 AND ec.company_id=e.company_id`,
      [job.email_id],
    );
    if (!result.rowCount) throw new Error("The email or connected mailbox no longer exists");
    const email = result.rows[0];
    if (email.connection_status !== "connected") {
      throw new Error("The selected mailbox needs to be reconnected");
    }
    const attachmentResult = await pool.query(
      `SELECT file_name, mime_type, size_bytes, content
       FROM email_attachments WHERE email_id=$1 ORDER BY created_at ASC`,
      [job.email_id],
    );
    const attachments = attachmentResult.rows.map((row) => ({
      file_name: String(row.file_name),
      mime_type: String(row.mime_type),
      size_bytes: Number(row.size_bytes),
      content: row.content as Buffer,
    })) satisfies EmailAttachmentInput[];
    const delivery = await deliverWithConnectedMailbox(email as ConnectedMailbox, {
      to: email.to_addresses,
      cc: email.cc_addresses,
      subject: email.subject,
      body: email.body,
      attachments,
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE emails
         SET status='sent', sent_at=CURRENT_TIMESTAMP, delivery_error=NULL,
             provider_message_id=$2, provider_thread_id=$3,
             internet_message_id=$4, updated_at=CURRENT_TIMESTAMP
         WHERE email_id=$1 RETURNING *`,
        [job.email_id, delivery.messageId, delivery.threadId, delivery.internetMessageId],
      );
      await client.query(
        `UPDATE email_delivery_jobs
         SET status='sent', completed_at=CURRENT_TIMESTAMP, locked_at=NULL,
             last_error=NULL, updated_at=CURRENT_TIMESTAMP
         WHERE email_delivery_job_id=$1`,
        [job.email_delivery_job_id],
      );
      const sent = updated.rows[0];
      await recordActivity(
        client,
        sent,
        "email",
        "email_sent",
        sent.subject,
        sent.created_by,
        {
          description: sent.body,
          metadata: {
            direction: "outbound",
            status: "sent",
            provider: sent.provider,
            from_address: sent.from_address,
            to_addresses: sent.to_addresses,
            attachment_count: attachments.length,
          },
          occurredAt: sent.sent_at,
        },
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return { jobId: job.email_delivery_job_id, emailId: job.email_id, sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email delivery failed";
    const retry = job.attempts < job.max_attempts && !/reconnect|authorization expired/i.test(message);
    await pool.query(
      `UPDATE email_delivery_jobs
       SET status=$2, next_attempt_at=CURRENT_TIMESTAMP +
             (LEAST(60, POWER(2, attempts)) * INTERVAL '1 minute'),
           locked_at=NULL, last_error=$3, updated_at=CURRENT_TIMESTAMP
       WHERE email_delivery_job_id=$1`,
      [job.email_delivery_job_id, retry ? "retrying" : "failed", message.slice(0, 4000)],
    );
    await pool.query(
      `UPDATE emails SET status='failed', delivery_error=$2, updated_at=CURRENT_TIMESTAMP
       WHERE email_id=$1`,
      [job.email_id, message.slice(0, 4000)],
    );
    return { jobId: job.email_delivery_job_id, emailId: job.email_id, sent: false, error: message };
  }
}
