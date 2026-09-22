import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { leadExists } from "@/lib/leadHistory";
import { parseLeadId } from "@/lib/leads";
import { parsePagination } from "@/utils/parsePagination";

type Context = { params: Promise<{ leadid: string }> };

export async function GET(request: NextRequest, context: Context) {
  const leadId = parseLeadId((await context.params).leadid);
  if (!leadId) {
    return NextResponse.json(
      { error: "leadId must be a valid UUID" },
      { status: 400 },
    );
  }
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }

  try {
    if (!(await leadExists(pool, leadId))) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    const result = await pool.query(
      `WITH timeline AS (
         SELECT history_id AS event_id, 'state_change'::text AS event_type,
                JSONB_BUILD_OBJECT(
                  'command', command, 'from_status', from_status,
                  'to_status', to_status, 'from_stage_id', from_stage_id,
                  'to_stage_id', to_stage_id, 'metadata', metadata,
                  'performed_by', performed_by
                ) AS data,
                created_at AS occurred_at
         FROM lead_state_history WHERE lead_id=$1
         UNION ALL
         SELECT ownership_history_id, 'ownership_change',
                JSONB_BUILD_OBJECT(
                  'change_type', change_type,
                  'from_owner_user_id', from_owner_user_id,
                  'to_owner_user_id', to_owner_user_id,
                  'from_team_id', from_team_id, 'to_team_id', to_team_id,
                  'performed_by', performed_by
                ),
                created_at
         FROM lead_ownership_history WHERE lead_id=$1
         UNION ALL
         SELECT attribution_id, 'attribution_added',
                JSONB_BUILD_OBJECT(
                  'source_id', source_id, 'campaign_id', campaign_id,
                  'attribution_type', attribution_type,
                  'sub_source', sub_source, 'metadata', metadata,
                  'created_by', created_by
                ),
                occurred_at
         FROM lead_attributions WHERE lead_id=$1
         UNION ALL
         SELECT th.tag_history_id, 'tag_' || th.action,
                JSONB_BUILD_OBJECT(
                  'tag_id', th.tag_id, 'tag_name', t.tag_name,
                  'performed_by', th.performed_by
                ),
                th.created_at
         FROM lead_tag_history th
         LEFT JOIN tags t ON t.tag_id=th.tag_id
         WHERE th.lead_id=$1
         UNION ALL
         SELECT next_action_history_id, 'next_action_updated',
                JSONB_BUILD_OBJECT(
                  'previous_action', previous_action,
                  'next_action', next_action,
                  'performed_by', performed_by
                ),
                created_at
         FROM lead_next_action_history WHERE lead_id=$1
       )
       SELECT event_id, event_type, data, occurred_at,
              COUNT(*) OVER()::integer AS total
       FROM timeline
       ORDER BY occurred_at DESC, event_id DESC
       LIMIT $2 OFFSET $3`,
      [leadId, pagination.limit, pagination.offset],
    );
    const total = Number(result.rows[0]?.total ?? 0);
    const events = result.rows.map((row) => ({
      event_id: row.event_id,
      event_type: row.event_type,
      data: row.data,
      occurred_at: row.occurred_at,
    }));
    return NextResponse.json({
      events,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve lead timeline", error);
    return NextResponse.json(
      { error: "Unable to retrieve lead timeline" },
      { status: 500 },
    );
  }
}
