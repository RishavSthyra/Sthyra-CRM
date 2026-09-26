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
      `SELECT s.*, COUNT(*) OVER()::integer AS total
       FROM opportunity_shortlists s WHERE s.opportunity_id=$1
       ORDER BY s.updated_at DESC, s.shortlist_id DESC LIMIT $2 OFFSET $3`,
      [access.opportunityId, pagination.limit, pagination.offset],
    );
    const total = Number(result.rows[0]?.total ?? 0);
    return NextResponse.json({
      shortlists: result.rows.map((row) => {
        const shortlist = { ...row };
        delete shortlist.total;
        return shortlist;
      }),
      pagination: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) },
    });
  } catch (error) {
    console.error("Failed to retrieve opportunity shortlists", error);
    return NextResponse.json({ error: "Unable to retrieve opportunity shortlists" }, { status: 500 });
  }
}
