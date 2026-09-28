import { NextRequest, NextResponse } from "next/server";
import {
  createIntakeEvent,
  processIntakeEvent,
  resolveIntakeCompanyId,
  validateIntakeEnvelope,
} from "@/lib/leadIntake";
import { adminPool } from "@/lib/db";
import { hasValidBearerSecret } from "@/lib/integrationAuth";
import { isObject } from "@/utils/isObject";

export async function POST(request: NextRequest) {
  const secret = process.env.LEAD_INTAKE_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Lead intake is not configured" },
      { status: 503 },
    );
  }
  if (!hasValidBearerSecret(request, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      const companyId = await resolveIntakeCompanyId(validation.data);
      const stored = await createIntakeEvent(
        validation.data,
        companyId,
        adminPool,
      );
      const event = stored.created
        ? await processIntakeEvent(
            stored.event.event_id as string,
            adminPool,
          )
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
