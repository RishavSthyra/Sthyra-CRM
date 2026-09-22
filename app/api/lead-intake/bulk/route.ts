import { NextRequest, NextResponse } from "next/server";
import {
  createIntakeEvent,
  processIntakeEvent,
  validateIntakeEnvelope,
} from "@/lib/leadIntake";
import { isObject } from "@/utils/isObject";

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
  if (!isObject(body) || !Array.isArray(body.events)) {
    return NextResponse.json(
      { error: "events must be an array" },
      { status: 422 },
    );
  }
  if (body.events.length === 0 || body.events.length > 100) {
    return NextResponse.json(
      { error: "events must contain between 1 and 100 items" },
      { status: 422 },
    );
  }

  const results: Record<string, unknown>[] = [];
  for (let index = 0; index < body.events.length; index += 1) {
    const validation = validateIntakeEnvelope(body.events[index]);
    if (!validation.ok) {
      results.push({ index, status: "rejected", errors: validation.errors });
      continue;
    }
    try {
      const stored = await createIntakeEvent(validation.data);
      const event = stored.created
        ? await processIntakeEvent(stored.event.event_id as string)
        : stored.event;
      results.push({ index, duplicate: !stored.created, event });
    } catch (error) {
      console.error("Failed to process bulk intake item", error);
      results.push({
        index,
        status: "failed",
        error: "Unable to process event",
      });
    }
  }
  return NextResponse.json({ results }, { status: 207 });
}
