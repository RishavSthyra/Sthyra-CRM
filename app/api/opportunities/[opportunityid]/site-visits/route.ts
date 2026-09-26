import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { APPOINTMENT_COLUMNS } from "@/lib/activities";
import { requireOpportunity } from "@/lib/opportunityAccess";
import { parsePagination } from "@/utils/parsePagination";

type Context = { params: Promise<{ opportunityid: string }> };
export async function GET(request: NextRequest, context: Context) {
  const access = await requireOpportunity(request, (await context.params).opportunityid);
  if (!access.ok) return access.response;
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok)
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  try {
    const result = await pool.query(
      `SELECT ${APPOINTMENT_COLUMNS}, sv.arrival_instructions, sv.transport_notes,
        sv.attendee_count, sv.check_in_at, sv.outcome, sv.feedback,
        sv.customer_rating, sv.next_action, sv.no_show_at, sv.no_show_reason,
        sv.reschedule_count, COUNT(*) OVER()::integer AS total
       FROM appointments ap JOIN site_visits sv ON sv.visit_id=ap.appointment_id
       WHERE ap.appointment_type='site_visit'
         AND (ap.opportunity_id=$1 OR (ap.opportunity_id IS NULL AND ap.lead_id=$2))
       ORDER BY ap.starts_at DESC, ap.appointment_id DESC
       LIMIT $3 OFFSET $4`,
      [access.opportunityId, access.opportunity.lead_id, pagination.limit, pagination.offset],
    );
    const total = Number(result.rows[0]?.total ?? 0);
    return NextResponse.json({
      site_visits: result.rows.map((row) => {
        const visit = { ...row };
        delete visit.total;
        return visit;
      }),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve opportunity site visits", error);
    return NextResponse.json({ error: "Unable to retrieve opportunity site visits" }, { status: 500 });
  }
}
