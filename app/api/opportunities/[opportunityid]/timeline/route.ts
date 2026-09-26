import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
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
      `WITH timeline AS (
         SELECT history_id AS event_id, 'state_change'::text AS event_type,
           JSONB_BUILD_OBJECT(
             'action', action, 'from_status', from_status, 'to_status', to_status,
             'from_stage_key', from_stage_key, 'to_stage_key', to_stage_key,
             'metadata', metadata, 'performed_by', performed_by
           ) AS data, created_at AS occurred_at
         FROM opportunity_state_history WHERE opportunity_id=$1
         UNION ALL
         SELECT ownership_history_id, 'ownership_change',
           JSONB_BUILD_OBJECT(
             'change_type', change_type, 'from_owner_user_id', from_owner_user_id,
             'to_owner_user_id', to_owner_user_id, 'from_team_id', from_team_id,
             'to_team_id', to_team_id, 'performed_by', performed_by
           ), created_at
         FROM opportunity_ownership_history WHERE opportunity_id=$1
         UNION ALL
         SELECT t.transfer_id, 'transfer_' || t.status,
           JSONB_BUILD_OBJECT(
             'transfer_id', t.transfer_id, 'status', t.status,
             'to_owner_user_id', t.to_owner_user_id, 'to_team_id', t.to_team_id,
             'reason', t.reason, 'requested_by', t.requested_by
           ), t.updated_at
         FROM transfers t WHERE t.opportunity_id=$1
         UNION ALL
         SELECT ap.appointment_id, 'site_visit_' || ap.status,
           JSONB_BUILD_OBJECT(
             'appointment_id', ap.appointment_id, 'title', ap.title,
             'starts_at', ap.starts_at, 'ends_at', ap.ends_at,
             'status', ap.status, 'location', ap.location
           ), ap.updated_at
         FROM appointments ap
         JOIN opportunities o ON o.opportunity_id=$1
         WHERE ap.appointment_type='site_visit'
           AND (ap.opportunity_id=$1 OR (ap.opportunity_id IS NULL AND ap.lead_id=o.lead_id))
         UNION ALL
         SELECT s.shortlist_id, 'shortlist_' || s.status,
           JSONB_BUILD_OBJECT('shortlist_id', s.shortlist_id, 'title', s.title, 'status', s.status),
           s.updated_at
         FROM opportunity_shortlists s WHERE s.opportunity_id=$1
         UNION ALL
         SELECT q.quotation_id, 'quotation_' || q.status,
           JSONB_BUILD_OBJECT(
             'quotation_id', q.quotation_id, 'quotation_number', q.quotation_number,
             'version', q.version, 'status', q.status, 'total_amount', q.total_amount,
             'currency', q.currency
           ), q.updated_at
         FROM opportunity_quotations q WHERE q.opportunity_id=$1
       )
       SELECT event_id, event_type, data, occurred_at,
              COUNT(*) OVER()::integer AS total
       FROM timeline
       ORDER BY occurred_at DESC, event_id DESC
       LIMIT $2 OFFSET $3`,
      [access.opportunityId, pagination.limit, pagination.offset],
    );
    const total = Number(result.rows[0]?.total ?? 0);
    return NextResponse.json({
      events: result.rows.map((row) => {
        const event = { ...row };
        delete event.total;
        return event;
      }),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve opportunity timeline", error);
    return NextResponse.json({ error: "Unable to retrieve opportunity timeline" }, { status: 500 });
  }
}
