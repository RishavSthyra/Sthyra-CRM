import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  PermissionContextResult,
  requirePermission,
} from "@/lib/authorization";
import { hasProjectWideLeadVisibility } from "@/lib/projectAccessPolicy";

export type LeadVisibility = {
  userId: string;
  teamId: string;
  canViewProjectWide: boolean;
};

type LeadVisibilityResult =
  | {
      ok: true;
      context: Extract<PermissionContextResult, { ok: true }>['context'] & {
        leadVisibility: LeadVisibility;
      };
    }
  | { ok: false; response: NextResponse };

export async function requireLeadVisibility(
  request: NextRequest,
  permission: "LEADS_VIEW" | "LEADS_CREATE" | "LEADS_UPDATE" | "LEADS_ASSIGN",
): Promise<LeadVisibilityResult> {
  const scope = await requirePermission(request, permission);
  if (!scope.ok) return scope;

  // Project access already verifies the active user/team/company membership.
  // Reuse that derived context instead of repeating the membership query.
  const team = scope.context.access.team;
  return {
    ok: true,
    context: {
      ...scope.context,
      leadVisibility: {
        userId: scope.context.userId,
        teamId: team.team_id,
        canViewProjectWide: hasProjectWideLeadVisibility({
          roleKey: scope.context.access.roleKey,
          teamName: team.team_name,
          permissions: scope.context.permissions,
        }),
      },
    },
  };
}

export function addLeadVisibilityFilter(
  filters: string[],
  values: unknown[],
  visibility: LeadVisibility,
  alias = "l",
) {
  if (visibility.canViewProjectWide) return;
  values.push(visibility.userId);
  const userParameter = `$${values.length}`;
  values.push(visibility.teamId);
  const teamParameter = `$${values.length}`;
  filters.push(
    `(${alias}.current_owner_user_id=${userParameter} OR ${alias}.current_team_id=${teamParameter})`,
  );
}

export async function canUpdateLead(
  leadId: string,
  visibility: LeadVisibility,
) {
  const values: unknown[] = [leadId];
  const filters = ["l.lead_id=$1"];
  addLeadVisibilityFilter(filters, values, visibility);
  const result = await pool.query(
    `SELECT 1 FROM leads l WHERE ${filters.join(" AND ")}`,
    values,
  );
  return Boolean(result.rowCount);
}
