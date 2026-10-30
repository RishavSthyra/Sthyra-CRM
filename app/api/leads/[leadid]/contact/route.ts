import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { updateContact, validateContactProfilePayload } from "@/lib/contacts";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";
import { parseLeadId } from "@/lib/leads";
import {
  addLeadVisibilityFilter,
  requireLeadVisibility,
} from "@/lib/leadVisibility";
import { leadRequiresReopen } from "@/lib/leadMutationPolicy";

type Context = { params: Promise<{ leadid: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireLeadVisibility(request, "LEADS_UPDATE");
  if (!scope.ok) return scope.response;

  const leadId = parseLeadId((await context.params).leadid);
  if (!leadId) {
    return NextResponse.json(
      { error: "leadId must be a valid UUID" },
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

  const validation = validateContactProfilePayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const values: unknown[] = [leadId];
    const filters = ["l.lead_id=$1"];
    addLeadVisibilityFilter(filters, values, scope.context.leadVisibility);
    const result = await client.query(
      `SELECT c.*, l.status AS lead_status
       FROM leads l
       JOIN contacts c ON c.contact_id=l.contact_id
       WHERE ${filters.join(" AND ")}
         AND c.company_id=$${values.length + 1}
         AND c.archived_at IS NULL
       FOR UPDATE OF c`,
      [...values, scope.context.access.company.company_id],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    if (leadRequiresReopen(result.rows[0].lead_status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: `Reopen this ${result.rows[0].lead_status} lead before editing its contact profile`,
          code: "LEAD_REOPEN_REQUIRED",
        },
        { status: 409 },
      );
    }

    const contact = await updateContact(
      client,
      result.rows[0],
      validation.data,
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Contact profile updated", contact });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (getDatabaseErrorCode(error) === "23514") {
      return NextResponse.json(
        { error: "Invalid contact profile data" },
        { status: 422 },
      );
    }
    console.error("Failed to update lead contact profile", error);
    return NextResponse.json(
      { error: "Unable to update contact profile" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function GET(request: NextRequest, context: Context) {
  const scope = await requireLeadVisibility(request, "LEADS_VIEW");
  if (!scope.ok) return scope.response;

  const leadId = parseLeadId((await context.params).leadid);
  if (!leadId) {
    return NextResponse.json(
      { error: "leadId must be a valid UUID" },
      { status: 400 },
    );
  }

  const values: unknown[] = [leadId];
  const filters = ["l.lead_id=$1"];
  addLeadVisibilityFilter(filters, values, scope.context.leadVisibility);
  try {
    const result = await pool.query(
      `SELECT TO_JSONB(c) AS contact
       FROM leads l
       JOIN contacts c ON c.contact_id=l.contact_id
       WHERE ${filters.join(" AND ")}
         AND c.company_id=$${values.length + 1}
         AND c.archived_at IS NULL`,
      [...values, scope.context.access.company.company_id],
    );
    if (!result.rowCount) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    return NextResponse.json({ contact: result.rows[0].contact });
  } catch (error) {
    console.error("Failed to retrieve lead contact profile", error);
    return NextResponse.json(
      { error: "Unable to retrieve contact profile" },
      { status: 500 },
    );
  }
}
