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
      `SELECT t.*,
        JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'history_id', h.history_id, 'action', h.action,
            'from_status', h.from_status, 'to_status', h.to_status,
            'metadata', h.metadata, 'performed_by', h.performed_by,
            'created_at', h.created_at
          ) ORDER BY h.created_at, h.history_id
        ) FILTER (WHERE h.history_id IS NOT NULL) AS history,
        COUNT(*) OVER()::integer AS total
       FROM transfers t
       LEFT JOIN transfer_history h ON h.transfer_id=t.transfer_id
       WHERE t.opportunity_id=$1
       GROUP BY t.transfer_id
       ORDER BY t.created_at DESC, t.transfer_id DESC
       LIMIT $2 OFFSET $3`,
      [access.opportunityId, pagination.limit, pagination.offset],
    );
    const total = Number(result.rows[0]?.total ?? 0);
    return NextResponse.json({
      transfer_history: result.rows.map((row) => {
        const transfer = { ...row };
        delete transfer.total;
        return transfer;
      }),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve opportunity transfer history", error);
    return NextResponse.json({ error: "Unable to retrieve opportunity transfer history" }, { status: 500 });
  }
}
