import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { INTAKE_EVENT_COLUMNS } from "@/lib/leadIntake";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  try {
    const count = await pool.query(
      "SELECT COUNT(*)::integer AS total FROM lead_intake_events WHERE status='quarantined'",
    );
    const result = await pool.query(
      `SELECT ${INTAKE_EVENT_COLUMNS} FROM lead_intake_events
       WHERE status='quarantined' ORDER BY received_at DESC, event_id DESC
       LIMIT $1 OFFSET $2`,
      [pagination.limit, pagination.offset],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      events: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list quarantined events", error);
    return NextResponse.json(
      { error: "Unable to retrieve quarantine" },
      { status: 500 },
    );
  }
}
