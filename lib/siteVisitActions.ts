import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { advanceOpportunityToStage } from "@/lib/opportunities";
import { recordActivity } from "@/lib/activities";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import {
  addSiteVisitHistory,
  getSiteVisit,
  parseVisitUuid,
} from "@/lib/siteVisits";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

type SiteVisitAction =
  "confirm" | "check-in" | "complete" | "no-show" | "cancel";

function allowedStatuses(action: SiteVisitAction) {
  if (action === "confirm") return ["scheduled", "rescheduled"];
  if (action === "check-in") return ["scheduled", "confirmed", "rescheduled"];
  if (action === "complete") return ["checked_in"];
  if (action === "no-show") return ["scheduled", "confirmed", "rescheduled"];
  return ["scheduled", "confirmed", "rescheduled"];
}

export async function changeSiteVisitState(
  request: NextRequest,
  rawVisitId: string,
  action: SiteVisitAction,
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const visitId = parseVisitUuid(rawVisitId);
  if (!visitId)
    return NextResponse.json(
      { error: "visitId must be a valid UUID" },
      { status: 400 },
    );
  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  if (!isObject(body) || Array.isArray(body))
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 422 },
    );
  const errors: string[] = [];
  const permitted =
    action === "check-in"
      ? ["latitude", "longitude", "notes"]
      : action === "complete"
        ? ["outcome", "feedback", "customer_rating", "next_action"]
        : action === "no-show" || action === "cancel"
          ? ["reason"]
          : [];
  Object.keys(body)
    .filter((key) => !permitted.includes(key))
    .forEach((key) => errors.push(`Unknown field: ${key}`));
  let reason: string | null | undefined;
  let notes: string | null | undefined;
  let feedback: string | null | undefined;
  let nextAction: string | null | undefined;
  if (["no-show", "cancel"].includes(action)) {
    reason = validateText(body.reason, "reason", 5000, false, errors);
    if (!reason) errors.push("reason is required");
  }
  if (action === "check-in")
    notes = validateText(body.notes, "notes", 5000, true, errors);
  if (action === "complete") {
    feedback = validateText(body.feedback, "feedback", 10000, true, errors);
    nextAction = validateText(
      body.next_action,
      "next_action",
      5000,
      true,
      errors,
    );
  }
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (
    action === "check-in" &&
    (body.latitude !== undefined || body.longitude !== undefined)
  ) {
    if (
      typeof body.latitude !== "number" ||
      body.latitude < -90 ||
      body.latitude > 90
    )
      errors.push("latitude must be between -90 and 90");
    else latitude = body.latitude;
    if (
      typeof body.longitude !== "number" ||
      body.longitude < -180 ||
      body.longitude > 180
    )
      errors.push("longitude must be between -180 and 180");
    else longitude = body.longitude;
  }
  const outcomes = [
    "interested",
    "follow_up",
    "not_interested",
    "booking_requested",
    "needs_time",
    "unreachable",
  ];
  let outcome: string | null = null;
  let rating: number | null = null;
  if (action === "complete") {
    if (!outcomes.includes(String(body.outcome)))
      errors.push(`outcome must be one of: ${outcomes.join(", ")}`);
    else outcome = String(body.outcome);
    if (body.customer_rating !== undefined && body.customer_rating !== null) {
      if (
        !Number.isInteger(body.customer_rating) ||
        Number(body.customer_rating) < 1 ||
        Number(body.customer_rating) > 5
      )
        errors.push(
          "customer_rating must be an integer between 1 and 5 or null",
        );
      else rating = Number(body.customer_rating);
    }
  }
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const visit = await getSiteVisit(client, visitId, true);
    if (!visit) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Site visit not found" },
        { status: 404 },
      );
    }
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(visit.company_id),
        Number(visit.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this site visit" },
        { status: 403 },
      );
    }
    if (!allowedStatuses(action).includes(String(visit.status))) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `Cannot ${action} a site visit with status ${visit.status}` },
        { status: 409 },
      );
    }
    if (
      action === "no-show" &&
      new Date(visit.starts_at as string).getTime() > Date.now()
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "A future site visit cannot be marked as no-show" },
        { status: 409 },
      );
    }
    const nextStatus =
      action === "check-in"
        ? "checked_in"
        : action === "no-show"
          ? "no_show"
          : action === "cancel"
            ? "cancelled"
            : action === "complete"
              ? "completed"
              : "confirmed";
    const appointment = await client.query(
      `UPDATE appointments SET status=$2, updated_by=$3, updated_at=CURRENT_TIMESTAMP,
       confirmed_at=CASE WHEN $2='confirmed' THEN CURRENT_TIMESTAMP ELSE confirmed_at END,
       confirmed_by=CASE WHEN $2='confirmed' THEN $3 ELSE confirmed_by END,
       completed_at=CASE WHEN $2='completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,
       completed_by=CASE WHEN $2='completed' THEN $3 ELSE completed_by END,
       cancelled_at=CASE WHEN $2 IN ('cancelled','no_show') THEN CURRENT_TIMESTAMP ELSE cancelled_at END,
       cancelled_by=CASE WHEN $2 IN ('cancelled','no_show') THEN $3 ELSE cancelled_by END,
       cancellation_reason=CASE WHEN $2 IN ('cancelled','no_show') THEN $4 ELSE cancellation_reason END
       WHERE appointment_id=$1 RETURNING *`,
      [visitId, nextStatus, scope.context.userId, reason ?? null],
    );
    await client.query(
      `UPDATE site_visits SET updated_at=CURRENT_TIMESTAMP,
       check_in_at=CASE WHEN $2='checked_in' THEN CURRENT_TIMESTAMP ELSE check_in_at END,
       checked_in_by=CASE WHEN $2='checked_in' THEN $3 ELSE checked_in_by END,
       check_in_latitude=CASE WHEN $2='checked_in' THEN $4 ELSE check_in_latitude END,
       check_in_longitude=CASE WHEN $2='checked_in' THEN $5 ELSE check_in_longitude END,
       check_in_notes=CASE WHEN $2='checked_in' THEN $6 ELSE check_in_notes END,
       outcome=CASE WHEN $2='completed' THEN $7 ELSE outcome END,
       feedback=CASE WHEN $2='completed' THEN $8 ELSE feedback END,
       customer_rating=CASE WHEN $2='completed' THEN $9 ELSE customer_rating END,
       next_action=CASE WHEN $2='completed' THEN $10 ELSE next_action END,
       no_show_at=CASE WHEN $2='no_show' THEN CURRENT_TIMESTAMP ELSE no_show_at END,
       no_show_by=CASE WHEN $2='no_show' THEN $3 ELSE no_show_by END,
       no_show_reason=CASE WHEN $2='no_show' THEN $11 ELSE no_show_reason END
       WHERE visit_id=$1`,
      [
        visitId,
        nextStatus,
        scope.context.userId,
        latitude,
        longitude,
        notes ?? null,
        outcome,
        feedback ?? null,
        rating,
        nextAction ?? null,
        reason ?? null,
      ],
    );
    if (nextStatus === "no_show")
      await client.query(
        "UPDATE site_visit_participants SET attendance_status='absent', updated_at=CURRENT_TIMESTAMP WHERE visit_id=$1 AND attendance_status IN ('expected','confirmed')",
        [visitId],
      );
    if (nextStatus === "completed")
      await advanceOpportunityToStage(
        client,
        {
          opportunityId: visit.opportunity_id as string | null,
          leadId: visit.lead_id as string | null,
        },
        "site_visit",
        "site_visit_completed",
        scope.context.userId,
      );
    await addSiteVisitHistory(
      client,
      visitId,
      action.replace("-", "_"),
      String(visit.status),
      nextStatus,
      scope.context.userId,
      { reason: reason ?? null, outcome, customer_rating: rating },
    );
    await recordActivity(
      client,
      appointment.rows[0],
      "appointment",
      `site_visit_${nextStatus}`,
      `Site visit ${nextStatus.replace("_", " ")}: ${visit.title}`,
      scope.context.userId,
      {
        description: reason ?? feedback ?? notes ?? null,
        metadata: { outcome, customer_rating: rating },
      },
    );
    const updated = await getSiteVisit(client, visitId);
    await client.query("COMMIT");
    return NextResponse.json({
      message: `Site visit ${nextStatus.replace("_", " ")}`,
      site_visit: updated,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(`Failed to ${action} site visit`, error);
    return NextResponse.json(
      { error: `Unable to ${action} site visit` },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function rescheduleSiteVisit(
  request: NextRequest,
  rawVisitId: string,
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const visitId = parseVisitUuid(rawVisitId);
  if (!visitId)
    return NextResponse.json(
      { error: "visitId must be a valid UUID" },
      { status: 400 },
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  if (!isObject(body) || Array.isArray(body))
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 422 },
    );
  const errors = Object.keys(body)
    .filter((key) => !["starts_at", "ends_at", "reason"].includes(key))
    .map((key) => `Unknown field: ${key}`);
  const startsAt =
    typeof body.starts_at === "string" &&
    !Number.isNaN(Date.parse(body.starts_at))
      ? new Date(body.starts_at).toISOString()
      : null;
  const endsAt =
    typeof body.ends_at === "string" && !Number.isNaN(Date.parse(body.ends_at))
      ? new Date(body.ends_at).toISOString()
      : null;
  if (!startsAt) errors.push("starts_at must be a valid date-time");
  if (!endsAt) errors.push("ends_at must be a valid date-time");
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt))
    errors.push("ends_at must be after starts_at");
  const reason = validateText(body.reason, "reason", 5000, false, errors);
  if (!reason) errors.push("reason is required");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const visit = await getSiteVisit(client, visitId, true);
    if (!visit) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Site visit not found" },
        { status: 404 },
      );
    }
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(visit.company_id),
        Number(visit.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this site visit" },
        { status: 403 },
      );
    }
    if (
      !["scheduled", "confirmed", "rescheduled"].includes(String(visit.status))
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `Cannot reschedule a site visit with status ${visit.status}` },
        { status: 409 },
      );
    }
    const result = await client.query(
      `UPDATE appointments SET status='rescheduled', starts_at=$2, ends_at=$3, reschedule_reason=$4, confirmed_at=NULL, confirmed_by=NULL, updated_by=$5, updated_at=CURRENT_TIMESTAMP WHERE appointment_id=$1 RETURNING *`,
      [visitId, startsAt, endsAt, reason, scope.context.userId],
    );
    await client.query(
      "UPDATE site_visits SET reschedule_count=reschedule_count+1, updated_at=CURRENT_TIMESTAMP WHERE visit_id=$1",
      [visitId],
    );
    await addSiteVisitHistory(
      client,
      visitId,
      "reschedule",
      String(visit.status),
      "rescheduled",
      scope.context.userId,
      { reason, starts_at: startsAt, ends_at: endsAt },
      visit.starts_at,
      visit.ends_at,
    );
    await recordActivity(
      client,
      result.rows[0],
      "appointment",
      "site_visit_rescheduled",
      `Site visit rescheduled: ${visit.title}`,
      scope.context.userId,
      {
        description: reason,
        metadata: {
          previous_starts_at: visit.starts_at,
          previous_ends_at: visit.ends_at,
          starts_at: startsAt,
          ends_at: endsAt,
        },
      },
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Site visit rescheduled",
      site_visit: { ...result.rows[0], visit_id: visitId },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to reschedule site visit", error);
    return NextResponse.json(
      { error: "Unable to reschedule site visit" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
