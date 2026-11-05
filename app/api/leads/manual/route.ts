import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireLeadVisibility } from "@/lib/leadVisibility";
import { createLead, LeadReferenceError } from "@/lib/leads";
import {
  resolveOrCreateManualContact,
  validateManualLeadCreationPayload,
} from "@/lib/manualLeadCreation";
import { canAccessProject } from "@/lib/projectAccess";

class ExistingLeadError extends Error {
  constructor(readonly leadId: string) {
    super("An active lead already exists for this contact and project");
    this.name = "ExistingLeadError";
  }
}

export async function POST(request: NextRequest) {
  const scope = await requireLeadVisibility(request, "LEADS_CREATE");
  if (!scope.ok) return scope.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }

  const validation = validateManualLeadCreationPayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  if (!canAccessProject(scope.context.access, validation.data.project_id)) {
    return NextResponse.json(
      { error: "You do not have access to this project" },
      { status: 403 },
    );
  }

  const companyId = scope.context.access.company.company_id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const contact = await resolveOrCreateManualContact(
      client,
      validation.data.contact,
      companyId,
    );
    const existingLead = await client.query(
      `SELECT lead_id
       FROM leads
       WHERE company_id=$1
         AND contact_id=$2
         AND project_id=$3
         AND status NOT IN ('invalid', 'dead', 'duplicate', 'closed')
       ORDER BY created_at DESC
       LIMIT 1`,
      [companyId, contact.contactId, validation.data.project_id],
    );
    if (existingLead.rowCount) {
      throw new ExistingLeadError(String(existingLead.rows[0].lead_id));
    }

    const lead = await createLead(
      client,
      {
        ...validation.data.lead,
        contact_id: contact.contactId,
        project_id: validation.data.project_id,
      },
      companyId,
      null,
      {
        initialStageKey: validation.data.stage_key,
        performedBy: scope.context.userId,
      },
    );
    await client.query("COMMIT");
    return NextResponse.json(
      {
        message: "Lead created",
        lead,
        contact_reused: !contact.created,
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ExistingLeadError) {
      return NextResponse.json(
        { error: error.message, existing_lead_id: error.leadId },
        { status: 409 },
      );
    }
    if (error instanceof LeadReferenceError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error("Failed to manually create lead", error);
    return NextResponse.json(
      { error: "Unable to create lead" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
