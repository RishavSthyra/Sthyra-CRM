import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { leadExists, listOwnershipHistory } from "@/lib/leadHistory";
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
    const history = await listOwnershipHistory(
      pool,
      leadId,
      pagination.limit,
      pagination.offset,
    );
    return NextResponse.json({
      ownership_history: history.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: history.total,
        totalPages: Math.ceil(history.total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve lead ownership history", error);
    return NextResponse.json(
      { error: "Unable to retrieve lead ownership history" },
      { status: 500 },
    );
  }
}
