import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { INTAKE_EVENT_COLUMNS } from "@/lib/leadIntake";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  const status = request.nextUrl.searchParams.get("status");
  const statuses = [
    "received",
    "processed",
    "quarantined",
    "failed",
    "discarded",
  ];
  if (status && !statuses.includes(status)) {
    return NextResponse.json(
      { error: "Invalid event status" },
      { status: 400 },
    );
  }
  const values: unknown[] = [];
  const where = status ? (values.push(status), "WHERE status=$1") : "";
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM lead_intake_events ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${INTAKE_EVENT_COLUMNS} FROM lead_intake_events ${where}
       ORDER BY received_at DESC, event_id DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
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
    console.error("Failed to list intake events", error);
    return NextResponse.json(
      { error: "Unable to retrieve intake events" },
      { status: 500 },
    );
  }
}
