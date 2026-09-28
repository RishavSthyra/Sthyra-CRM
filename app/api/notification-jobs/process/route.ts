import { NextRequest, NextResponse } from "next/server";
import { adminPool } from "@/lib/db";
import { deliverCrmEmail } from "@/lib/emailDelivery";
import { hasValidBearerSecret } from "@/lib/integrationAuth";
import {
  createNotificationsForUsers,
  resolveNotificationRecipients,
} from "@/lib/notifications";

function isAuthorized(request: NextRequest) {
  return hasValidBearerSecret(request, process.env.CRON_SECRET);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function processQueuedEmails(limit = 50) {
  const results = { sent: 0, failed: 0 };
  for (let index = 0; index < limit; index += 1) {
    const client = await adminPool.connect();
    let delivery: Record<string, unknown> | null = null;
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        `WITH candidate AS (
           SELECT delivery.delivery_id
           FROM notification_deliveries delivery
           WHERE delivery.channel='email'
             AND delivery.status IN ('queued','failed')
             AND delivery.attempt_count < delivery.max_attempts
             AND COALESCE(delivery.next_attempt_at, delivery.created_at) <= CURRENT_TIMESTAMP
           ORDER BY COALESCE(delivery.next_attempt_at, delivery.created_at), delivery.created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE notification_deliveries delivery
         SET status='sending', attempt_count=attempt_count+1,
             error_message=NULL, updated_at=CURRENT_TIMESTAMP
         FROM candidate
         WHERE delivery.delivery_id=candidate.delivery_id
         RETURNING delivery.*`,
      );
      if (!claimed.rowCount) {
        await client.query("COMMIT");
        break;
      }
      const claimedDelivery = claimed.rows[0] as Record<string, unknown>;
      delivery = claimedDelivery;
      const recipient = await client.query(
        "SELECT email FROM users WHERE user_id=$1 AND is_active=TRUE AND deleted_at IS NULL",
        [claimedDelivery.user_id],
      );
      if (!recipient.rowCount || !recipient.rows[0].email) {
        await client.query(
          `UPDATE notification_deliveries
           SET status='failed', error_message='Recipient email is unavailable',
               failed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
           WHERE delivery_id=$1`,
          [claimedDelivery.delivery_id],
        );
        await client.query("COMMIT");
        results.failed += 1;
        continue;
      }
      claimedDelivery.recipient = recipient.rows[0].email;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      console.error("Failed to claim notification delivery", error);
      break;
    } finally {
      client.release();
    }

    if (!delivery) break;
    const payload = (delivery.payload ?? {}) as Record<string, unknown>;
    const title = String(payload.title ?? "CRM notification");
    const body = String(payload.body ?? "You have a new CRM notification.");
    const delivered = await deliverCrmEmail({
      fromAddress:
        process.env.SMTP_FROM ??
        process.env.SMTP_USER ??
        "notifications@sthyra.local",
      to: [String(delivery.recipient)],
      cc: [],
      subject: title,
      body: `<p>${escapeHtml(body)}</p>`,
      attachments: [],
    });
    const attempts = Number(delivery.attempt_count);
    await adminPool.query(
      `UPDATE notification_deliveries
       SET status=$2,
           provider_message_id=$3,
           error_message=$4,
           recipient=$5,
           sent_at=CASE WHEN $2='sent' THEN CURRENT_TIMESTAMP ELSE sent_at END,
           failed_at=CASE WHEN $2='failed' AND $6>=max_attempts THEN CURRENT_TIMESTAMP ELSE NULL END,
           next_attempt_at=CASE WHEN $2='failed' AND $6<max_attempts
             THEN CURRENT_TIMESTAMP + (POWER(2,$6) * INTERVAL '5 minutes') ELSE NULL END,
           updated_at=CURRENT_TIMESTAMP
       WHERE delivery_id=$1`,
      [
        delivery.delivery_id,
        delivered.sent ? "sent" : "failed",
        delivered.sent ? delivered.messageId : null,
        delivered.sent
          ? null
          : delivered.configured
            ? delivered.error
            : "SMTP is not configured",
        delivery.recipient,
        attempts,
      ],
    );
    if (delivered.sent) results.sent += 1;
    else results.failed += 1;
  }
  return results;
}

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "Notification jobs are not configured" },
      { status: 503 },
    );
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");

    const followUps = await client.query(
      `SELECT
         next_action.lead_id,
         next_action.summary,
         next_action.due_at,
         lead.project_id,
         project.company_id,
         lead.current_owner_user_id,
         lead.current_team_id,
         TRIM(CONCAT(contact.first_name, ' ', contact.last_name)) AS contact_name
       FROM lead_next_actions next_action
       JOIN leads lead ON lead.lead_id = next_action.lead_id
       JOIN projects project ON project.project_id = lead.project_id
       JOIN contacts contact ON contact.contact_id = lead.contact_id
       WHERE next_action.status = 'pending'
         AND next_action.due_at < CURRENT_TIMESTAMP
       ORDER BY next_action.due_at ASC
       LIMIT 500
       FOR UPDATE OF next_action SKIP LOCKED`,
    );

    let overdueCreated = 0;
    for (const row of followUps.rows) {
      const recipients = await resolveNotificationRecipients(client, {
        companyId: Number(row.company_id),
        userIds: [row.current_owner_user_id],
        teamIds: [row.current_team_id],
      });
      const created = await createNotificationsForUsers(client, recipients, {
        companyId: Number(row.company_id),
        projectId: Number(row.project_id),
        type: "follow_up.overdue",
        category: "follow_up",
        title: "Follow-up overdue",
        body: `${row.contact_name || "A lead"}: ${row.summary}`,
        severity: "warning",
        entityType: "lead",
        entityId: String(row.lead_id),
        actionUrl: `/leads?lead_id=${row.lead_id}`,
        eventKey: `follow-up:${row.lead_id}:${new Date(row.due_at).toISOString()}:overdue`,
        metadata: { due_at: row.due_at },
        channels: ["in_app", "email"],
      });
      overdueCreated += created.length;
    }

    const appointments = await client.query(
      `SELECT
         appointment.appointment_id,
         appointment.appointment_type,
         appointment.title,
         appointment.starts_at,
         appointment.project_id,
         appointment.company_id,
         appointment.assigned_to_user_id,
         appointment.assigned_to_team_id,
         appointment.organizer_user_id
       FROM appointments appointment
       WHERE appointment.status IN ('scheduled', 'confirmed', 'rescheduled')
         AND appointment.starts_at > CURRENT_TIMESTAMP
         AND appointment.starts_at <= CURRENT_TIMESTAMP + INTERVAL '24 hours'
       ORDER BY appointment.starts_at ASC
       LIMIT 500`,
    );

    let remindersCreated = 0;
    for (const row of appointments.rows) {
      const recipients = await resolveNotificationRecipients(client, {
        companyId: Number(row.company_id),
        userIds: [row.assigned_to_user_id, row.organizer_user_id],
        teamIds: [row.assigned_to_team_id],
      });
      const isSiteVisit = row.appointment_type === "site_visit";
      const created = await createNotificationsForUsers(client, recipients, {
        companyId: Number(row.company_id),
        projectId: Number(row.project_id),
        type: isSiteVisit ? "site_visit.reminder" : "appointment.reminder",
        category: isSiteVisit ? "site_visit" : "appointment",
        title: isSiteVisit ? "Upcoming site visit" : "Upcoming appointment",
        body: `${row.title} starts within the next 24 hours.`,
        severity: "info",
        entityType: isSiteVisit ? "site_visit" : "appointment",
        entityId: String(row.appointment_id),
        actionUrl: `/calendar?appointment_id=${row.appointment_id}`,
        eventKey: `appointment:${row.appointment_id}:${new Date(row.starts_at).toISOString()}:24h`,
        metadata: { starts_at: row.starts_at },
        channels: ["in_app", "email"],
      });
      remindersCreated += created.length;

      if (new Date(row.starts_at).getTime() <= Date.now() + 60 * 60 * 1000) {
        const urgent = await createNotificationsForUsers(client, recipients, {
          companyId: Number(row.company_id),
          projectId: Number(row.project_id),
          type: isSiteVisit
            ? "site_visit.reminder_1h"
            : "appointment.reminder_1h",
          category: isSiteVisit ? "site_visit" : "appointment",
          title: isSiteVisit
            ? "Site visit starts within an hour"
            : "Appointment starts within an hour",
          body: `${row.title} starts within the next hour.`,
          severity: "warning",
          entityType: isSiteVisit ? "site_visit" : "appointment",
          entityId: String(row.appointment_id),
          actionUrl: `/calendar?appointment_id=${row.appointment_id}`,
          eventKey: `appointment:${row.appointment_id}:${new Date(row.starts_at).toISOString()}:1h`,
          metadata: { starts_at: row.starts_at },
          channels: ["in_app", "email"],
        });
        remindersCreated += urgent.length;
      }
    }

    await client.query("COMMIT");
    const emailDeliveries = await processQueuedEmails();
    return NextResponse.json({
      processed: {
        overdue_follow_ups: followUps.rowCount ?? 0,
        upcoming_appointments: appointments.rowCount ?? 0,
      },
      notifications_created: overdueCreated + remindersCreated,
      email_deliveries: emailDeliveries,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Failed to process notification jobs", error);
    return NextResponse.json(
      { error: "Unable to process notification jobs" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
