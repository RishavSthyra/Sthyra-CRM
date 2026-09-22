import { NextRequest, NextResponse } from "next/server";
import {
  createIntakeEvent,
  processIntakeEvent,
  validateIntakeEnvelope,
} from "@/lib/leadIntake";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const validation = validateIntakeEnvelope(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  try {
    const stored = await createIntakeEvent(validation.data);
    if (!stored.created) {
      return NextResponse.json({ duplicate: true, event: stored.event });
    }
    const event = await processIntakeEvent(stored.event.event_id as string);
    return NextResponse.json(
      { event },
      { status: event.status === "processed" ? 201 : 202 },
    );
  } catch (error) {
    console.error("Failed to accept lead intake", error);
    return NextResponse.json(
      { error: "Unable to accept lead intake" },
      { status: 500 },
    );
  }
}
