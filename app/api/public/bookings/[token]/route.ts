import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { hashToken } from "@/lib/auth";
import {
  safePublicBookingForm,
  validateBookingSubmission,
} from "@/lib/bookingForms";
import { adminPool } from "@/lib/db";
import {
  createNotificationsForUsers,
  resolveNotificationRecipients,
} from "@/lib/notifications";
import { recordQuotationEvent } from "@/lib/quotations";
import { enforceRateLimits } from "@/lib/rateLimit";

type Context = { params: Promise<{ token: string }> };

async function resolveFormForUpdate(client: PoolClient, token: string) {
  return client.query(
    `SELECT form.*,
            quotation.quotation_number,quotation.version AS quotation_version,
            quotation.status AS quotation_status,
            opportunity.opportunity_name,opportunity.stage_key,
            opportunity.status AS opportunity_status,
            opportunity.current_owner_user_id,opportunity.current_team_id,
            project.project_name,project.project_code,
            company.company_name,company.company_legal_name,
            company.company_phone_number,company.company_contact_email
     FROM booking_forms form
     JOIN opportunity_quotations quotation ON quotation.quotation_id=form.quotation_id
     JOIN opportunities opportunity ON opportunity.opportunity_id=form.opportunity_id
     JOIN projects project ON project.project_id=form.project_id
     JOIN companies company ON company.company_id=form.company_id
     WHERE form.token_hash=$1
     FOR UPDATE OF form,quotation,opportunity`,
    [hashToken(token)],
  );
}

function invalidToken(token: string) {
  return !token || token.length > 200;
}

export async function GET(request: NextRequest, context: Context) {
  const token = (await context.params).token.trim();
  if (invalidToken(token))
    return NextResponse.json({ error: "Invalid booking link" }, { status: 400 });
  const rateLimit = await enforceRateLimits(request, [
    { action: "booking-form-view:ip", limit: 120, windowSeconds: 10 * 60 },
    {
      action: "booking-form-view:token",
      subject: `booking-form:${token}`,
      limit: 60,
      windowSeconds: 10 * 60,
    },
  ]);
  if (rateLimit) return rateLimit;
  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    const result = await resolveFormForUpdate(client, token);
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This booking link is invalid" },
        { status: 404 },
      );
    }
    let form = result.rows[0] as Record<string, unknown>;
    if (form.status === "revoked") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This booking link has been revoked" },
        { status: 410 },
      );
    }
    if (
      form.status === "expired" ||
      (form.status === "active" &&
        new Date(String(form.expires_at)).getTime() <= Date.now())
    ) {
      if (form.status === "active")
        await client.query(
          `UPDATE booking_forms SET status='expired',updated_at=CURRENT_TIMESTAMP
           WHERE booking_form_id=$1`,
          [form.booking_form_id],
        );
      await client.query("COMMIT");
      return NextResponse.json(
        { error: "This booking link has expired" },
        { status: 410 },
      );
    }
    if (form.status === "active") {
      const firstView = !form.first_viewed_at;
      form = (
        await client.query(
          `UPDATE booking_forms SET
             first_viewed_at=COALESCE(first_viewed_at,CURRENT_TIMESTAMP),
             last_viewed_at=CURRENT_TIMESTAMP,view_count=view_count+1,
             updated_at=CURRENT_TIMESTAMP
           WHERE booking_form_id=$1 RETURNING *`,
          [form.booking_form_id],
        )
      ).rows[0] as Record<string, unknown>;
      if (firstView)
        await recordQuotationEvent(client, result.rows[0], "booking_form_viewed", {
          comment: "Customer opened the secure booking form",
          metadata: { booking_form_id: form.booking_form_id },
        });
      form = { ...result.rows[0], ...form };
    }
    await client.query("COMMIT");
    const response = NextResponse.json({
      booking_form: safePublicBookingForm(form),
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to load public booking form", error);
    return NextResponse.json(
      { error: "Unable to load this booking form" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function POST(request: NextRequest, context: Context) {
  const token = (await context.params).token.trim();
  if (invalidToken(token))
    return NextResponse.json({ error: "Invalid booking link" }, { status: 400 });
  const rateLimit = await enforceRateLimits(request, [
    { action: "booking-form-submit:ip", limit: 20, windowSeconds: 60 * 60 },
    {
      action: "booking-form-submit:token",
      subject: `booking-form:${token}`,
      limit: 8,
      windowSeconds: 60 * 60,
    },
  ]);
  if (rateLimit) return rateLimit;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const validation = validateBookingSubmission(body);
  if (!validation.ok)
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );

  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    const result = await resolveFormForUpdate(client, token);
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This booking link is invalid" },
        { status: 404 },
      );
    }
    const form = result.rows[0] as Record<string, unknown>;
    if (form.status === "submitted" || form.status === "confirmed") {
      await client.query("COMMIT");
      return NextResponse.json({
        message: "This booking form has already been submitted",
        booking_reference: form.booking_reference,
        status: form.status,
      });
    }
    if (form.status === "revoked") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This booking link has been revoked" },
        { status: 410 },
      );
    }
    if (
      form.status === "expired" ||
      new Date(String(form.expires_at)).getTime() <= Date.now()
    ) {
      if (form.status === "active")
        await client.query(
          `UPDATE booking_forms SET status='expired',updated_at=CURRENT_TIMESTAMP
           WHERE booking_form_id=$1`,
          [form.booking_form_id],
        );
      await client.query("COMMIT");
      return NextResponse.json(
        { error: "This booking link has expired" },
        { status: 410 },
      );
    }
    if (
      form.quotation_status !== "accepted" ||
      form.opportunity_status !== "open" ||
      form.stage_key !== "booking"
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            "This booking is no longer ready for confirmation. Please contact the sales team.",
        },
        { status: 409 },
      );
    }
    const submitted = (
      await client.query(
        `UPDATE booking_forms SET status='submitted',customer_name=$2,phone_number=$3,
                submitted_at=CURRENT_TIMESTAMP,acknowledged_at=CURRENT_TIMESTAMP,
                updated_at=CURRENT_TIMESTAMP
         WHERE booking_form_id=$1 RETURNING *`,
        [
          form.booking_form_id,
          validation.data.name,
          validation.data.phone,
        ],
      )
    ).rows[0] as Record<string, unknown>;
    await recordQuotationEvent(client, form, "booking_form_submitted", {
      actorName: validation.data.name,
      comment: "Customer submitted the booking form",
      metadata: {
        booking_form_id: form.booking_form_id,
        booking_reference: form.booking_reference,
        unit_id: form.unit_id,
      },
    });
    const recipients = await resolveNotificationRecipients(client, {
      companyId: Number(form.company_id),
      userIds: [form.current_owner_user_id as string | null],
      teamIds: [form.current_team_id as string | null],
    });
    await createNotificationsForUsers(client, recipients, {
      companyId: Number(form.company_id),
      projectId: Number(form.project_id),
      type: "booking.form_submitted",
      category: "booking",
      title: "Booking form submitted",
      body: `${validation.data.name} submitted ${String(form.booking_reference)} for ${String(form.flat_number)}.`,
      severity: "success",
      entityType: "booking_form",
      entityId: String(form.booking_form_id),
      actionUrl: `/opportunities?opportunity_id=${String(form.opportunity_id)}`,
      eventKey: `booking-form:${String(form.booking_form_id)}:submitted`,
      metadata: {
        booking_form_id: form.booking_form_id,
        quotation_id: form.quotation_id,
        unit_id: form.unit_id,
      },
      channels: ["in_app", "email"],
    });
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Your booking form has been submitted successfully",
      booking_reference: submitted.booking_reference,
      status: submitted.status,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to submit public booking form", error);
    return NextResponse.json(
      { error: "Unable to submit this booking form" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
