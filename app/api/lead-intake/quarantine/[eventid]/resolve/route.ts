import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { INTAKE_EVENT_COLUMNS, processIntakeEvent } from "@/lib/leadIntake";
import { parseUuidId } from "@/lib/leadAttribution";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

type Context = { params: Promise<{ eventid: string }> };

export async function POST(request: NextRequest, context: Context) {
  const eventId = parseUuidId((await context.params).eventid);
  if (!eventId) {
    return NextResponse.json(
      { error: "eventId must be a valid UUID" },
      { status: 400 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  if (!isObject(body) || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be an object" },
      { status: 422 },
    );
  }
  const errors: string[] = [];
  if (body.action !== "replay" && body.action !== "discard") {
    errors.push("action must be replay or discard");
  }
  const notes = validateText(body.notes, "notes", 5000, true, errors);
  if (errors.length) {
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
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
    if (existing.rows[0].status !== "quarantined") {
      return NextResponse.json(
        { error: "Event is not quarantined" },
        { status: 409 },
      );
    }
    if (body.action === "discard") {
      const result = await pool.query(
        `UPDATE lead_intake_events
         SET status='discarded', resolved_at=CURRENT_TIMESTAMP,
             resolution_action='discard', resolution_notes=$1, updated_at=CURRENT_TIMESTAMP
         WHERE event_id=$2 RETURNING ${INTAKE_EVENT_COLUMNS}`,
        [notes ?? null, eventId],
      );
      return NextResponse.json({
        message: "Event discarded",
        event: result.rows[0],
      });
    }
    let event = await processIntakeEvent(eventId);
    if (event.status === "processed") {
      const result = await pool.query(
        `UPDATE lead_intake_events
         SET resolved_at=CURRENT_TIMESTAMP, resolution_action='replay',
             resolution_notes=$1, updated_at=CURRENT_TIMESTAMP
         WHERE event_id=$2 RETURNING ${INTAKE_EVENT_COLUMNS}`,
        [notes ?? null, eventId],
      );
      event = result.rows[0];
    }
    return NextResponse.json({ message: "Event replay attempted", event });
  } catch (error) {
    console.error("Failed to resolve quarantined event", error);
    return NextResponse.json(
      { error: "Unable to resolve quarantined event" },
      { status: 500 },
    );
  }
}
