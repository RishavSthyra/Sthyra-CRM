import { NextRequest, NextResponse } from "next/server";
import {
  createIntakeEvent,
  processIntakeEvent,
  resolveIntakeCompanyId,
  validateIntakeEnvelope,
} from "@/lib/leadIntake";
import { adminPool } from "@/lib/db";
import { hasValidBearerSecret } from "@/lib/integrationAuth";

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
  const validation = validateIntakeEnvelope(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  try {
    const companyId = await resolveIntakeCompanyId(validation.data);
    const stored = await createIntakeEvent(
      validation.data,
      companyId,
      adminPool,
    );
    if (!stored.created) {
      return NextResponse.json({ duplicate: true, event: stored.event });
    }
    const event = await processIntakeEvent(
      stored.event.event_id as string,
      adminPool,
    );
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
