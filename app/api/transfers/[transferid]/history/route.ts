import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireTransfer } from "@/lib/transferAccess";
import { parsePagination } from "@/utils/parsePagination";

type Context = { params: Promise<{ transferid: string }> };
export async function GET(request: NextRequest, context: Context) {
  const access = await requireTransfer(request, (await context.params).transferid);
  if (!access.ok) return access.response;
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok)
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  try {
    const result = await pool.query(
      `SELECT h.*, u.first_name AS performed_by_first_name,
        u.last_name AS performed_by_last_name,
        COUNT(*) OVER()::integer AS total
       FROM transfer_history h
       LEFT JOIN users u ON u.user_id=h.performed_by
       WHERE h.transfer_id=$1
       ORDER BY h.created_at DESC, h.history_id DESC
       LIMIT $2 OFFSET $3`,
      [access.transferId, pagination.limit, pagination.offset],
    );
    const total = Number(result.rows[0]?.total ?? 0);
    return NextResponse.json({
      history: result.rows.map((row) => {
        const { total: _total, ...history } = row;
        void _total;
        return history;
      }),
      pagination: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) },
    });
  } catch (error) {
    console.error("Failed to retrieve transfer history", error);
    return NextResponse.json({ error: "Unable to retrieve transfer history" }, { status: 500 });
  }
}

