import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { processIntakeEvent } from "@/lib/leadIntake";
import { parseUuidId } from "@/lib/leadAttribution";

type Context = { params: Promise<{ eventid: string }> };
export async function POST(_request: NextRequest, context: Context) {
  const eventId = parseUuidId((await context.params).eventid);
  if (!eventId) {
    return NextResponse.json(
      { error: "eventId must be a valid UUID" },
      { status: 400 },
    );
  }
  try {
    const existing = await pool.query(
      "SELECT status FROM lead_intake_events WHERE event_id=$1",
      [eventId],
    );
    if (!existing.rowCount) {
      return NextResponse.json(
        { error: "Intake event not found" },
        { status: 404 },
      );
    }
    if (!["quarantined", "failed"].includes(existing.rows[0].status)) {
      return NextResponse.json(
        { error: "Only quarantined or failed events can be replayed" },
        { status: 409 },
      );
    }
    const event = await processIntakeEvent(eventId);
    return NextResponse.json({ message: "Replay completed", event });
  } catch (error) {
    console.error("Failed to replay intake event", error);
    return NextResponse.json(
      { error: "Unable to replay event" },
      { status: 500 },
    );
  }
}
