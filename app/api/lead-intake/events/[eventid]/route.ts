import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { INTAKE_EVENT_COLUMNS } from "@/lib/leadIntake";
import { parseUuidId } from "@/lib/leadAttribution";

type Context = { params: Promise<{ eventid: string }> };
export async function GET(_request: NextRequest, context: Context) {
  const eventId = parseUuidId((await context.params).eventid);
  if (!eventId) {
    return NextResponse.json(
      { error: "eventId must be a valid UUID" },
      { status: 400 },
    );
  }
  try {
    const result = await pool.query(
      `SELECT ${INTAKE_EVENT_COLUMNS} FROM lead_intake_events WHERE event_id=$1`,
      [eventId],
    );
    if (!result.rowCount) {
      return NextResponse.json(
        { error: "Intake event not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ event: result.rows[0] });
  } catch (error) {
    console.error("Failed to retrieve intake event", error);
    return NextResponse.json(
      { error: "Unable to retrieve intake event" },
      { status: 500 },
    );
  }
}
