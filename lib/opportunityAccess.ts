import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getOpportunity } from "@/lib/opportunities";
import { parseUuid } from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";

export async function requireOpportunity(
  request: NextRequest,
  rawOpportunityId: string,
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope;
  const opportunityId = parseUuid(rawOpportunityId);
  if (!opportunityId)
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "opportunityId must be a valid UUID" },
        { status: 400 },
      ),
    };
  try {
    const opportunity = await getOpportunity(pool, opportunityId);
    if (!opportunity)
      return {
        ok: false as const,
        response: NextResponse.json(
          { error: "Opportunity not found" },
          { status: 404 },
        ),
      };
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(opportunity.company_id),
        Number(opportunity.project_id),
      )
    )
      return {
        ok: false as const,
        response: NextResponse.json(
          { error: "You do not have access to this opportunity" },
          { status: 403 },
        ),
      };
    return {
      ok: true as const,
      context: scope.context,
      opportunityId,
      opportunity,
    };
  } catch (error) {
    console.error("Failed to resolve opportunity access", error);
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Unable to retrieve opportunity" },
        { status: 500 },
      ),
    };
  }
}

