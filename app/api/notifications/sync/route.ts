import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { getAccessibleProjectIds } from "@/lib/projectAccess";

type AppointmentNotificationRow = {
  appointment_id: string;
  appointment_type: string;
  project_id: number;
  title: string;
  starts_at: string;
};

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const appointments = await client.query<AppointmentNotificationRow>(
      `SELECT
         appointment.appointment_id,
         appointment.appointment_type,
         appointment.project_id,
         appointment.title,
         appointment.starts_at
       FROM appointments appointment
       WHERE appointment.company_id = $1
         AND appointment.project_id = ANY($2::integer[])
         AND appointment.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
         AND (
           appointment.organizer_user_id = $3
           OR appointment.assigned_to_user_id = $3
           OR EXISTS (
             SELECT 1
             FROM users current_user
             WHERE current_user.user_id = $3
               AND current_user.team_id = appointment.assigned_to_team_id
           )
         )
       ORDER BY appointment.created_at DESC
       LIMIT 200`,
      [
        scope.context.access.company.company_id,
        getAccessibleProjectIds(scope.context.access),
        scope.context.userId,
      ],
    );

    let created = 0;
    for (const appointment of appointments.rows) {
      const isSiteVisit = appointment.appointment_type === "site_visit";
      const notification = await createNotification(client, {
        companyId: scope.context.access.company.company_id,
        projectId: Number(appointment.project_id),
        userId: scope.context.userId,
        type: isSiteVisit ? "site_visit.created" : "appointment.created",
        category: isSiteVisit ? "site_visit" : "appointment",
        title: isSiteVisit ? "New site visit" : "New appointment",
        body: `${appointment.title} was scheduled for you.`,
        entityType: isSiteVisit ? "site_visit" : "appointment",
        entityId: appointment.appointment_id,
        actionUrl: `/calendar?appointment_id=${appointment.appointment_id}`,
        eventKey: `${isSiteVisit ? "site-visit" : "appointment"}:${appointment.appointment_id}:created:${scope.context.userId}`,
        metadata: { starts_at: appointment.starts_at },
        channels: ["in_app"],
      });
      if (notification) created += 1;
    }

    await client.query("COMMIT");
    return NextResponse.json({ synced: appointments.rowCount, created });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to synchronize notifications", error);
    return NextResponse.json(
      { error: "Unable to synchronize notifications" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
