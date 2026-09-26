import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  addOpportunityOwnershipHistory,
  getOpportunity,
  getOpportunityDetail,
  validateOpportunityPatch,
  validateOpportunityReferences,
} from "@/lib/opportunities";
import { parseUuid } from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";

type Context = { params: Promise<{ opportunityid: string }> };

export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const opportunityId = parseUuid((await context.params).opportunityid);
  if (!opportunityId)
    return NextResponse.json({ error: "opportunityId must be a valid UUID" }, { status: 400 });
  try {
    const opportunity = await getOpportunityDetail(pool, opportunityId);
    if (!opportunity)
      return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    if (!canAccessOperationsEntity(scope.context.access, Number(opportunity.company_id), Number(opportunity.project_id)))
      return NextResponse.json({ error: "You do not have access to this opportunity" }, { status: 403 });
    return NextResponse.json({ opportunity });
  } catch (error) {
    console.error("Failed to retrieve opportunity", error);
    return NextResponse.json({ error: "Unable to retrieve opportunity" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const opportunityId = parseUuid((await context.params).opportunityid);
  if (!opportunityId)
    return NextResponse.json({ error: "opportunityId must be a valid UUID" }, { status: 400 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 });
  }
  const validation = validateOpportunityPatch(body);
  if (!validation.ok)
    return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await getOpportunity(client, opportunityId, true);
    if (!current) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    }
    if (!canAccessOperationsEntity(scope.context.access, Number(current.company_id), Number(current.project_id))) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "You do not have access to this opportunity" }, { status: 403 });
    }
    const referenceErrors = await validateOpportunityReferences(
      client,
      Number(current.company_id),
      validation.data,
    );
    if (referenceErrors.length) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Validation failed", details: referenceErrors }, { status: 422 });
    }
    const entries = Object.entries(validation.data).filter(([, value]) => value !== undefined);
    const values = entries.map(([, value]) => value);
    values.push(scope.context.userId, opportunityId);
    const assignments = entries.map(([field], index) => `${field}=$${index + 1}`);
    const result = await client.query(
      `UPDATE opportunities SET ${assignments.join(", ")}, updated_by=$${values.length - 1},
       updated_at=CURRENT_TIMESTAMP WHERE opportunity_id=$${values.length} RETURNING *`,
      values,
    );
    const updated = result.rows[0];
    await addOpportunityOwnershipHistory(
      client,
      opportunityId,
      {
        owner: (current.current_owner_user_id as string | null) ?? null,
        team: (current.current_team_id as string | null) ?? null,
      },
      { owner: updated.current_owner_user_id ?? null, team: updated.current_team_id ?? null },
      scope.context.userId,
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Opportunity updated", opportunity: updated });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to update opportunity", error);
    return NextResponse.json({ error: "Unable to update opportunity" }, { status: 500 });
  } finally {
    client.release();
  }
}
