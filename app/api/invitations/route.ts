import { NextRequest, NextResponse } from "next/server";
import pool, { adminPool } from "@/lib/db";
import {
  createInvitationToken,
  invitationUrl,
  sendInvitationEmail,
} from "@/lib/invitations";
import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";
import { invitationAccountConflictMessage } from "@/lib/invitationPolicy";
import { isSuperAdminRole } from "@/lib/systemRoles";
import { requirePermission } from "@/lib/authorization";
import {
  requireProjectAccessManager,
} from "@/lib/projectAccessAdministration";
import { isCompanyWideProjectRole } from "@/lib/projectAccessPolicy";
import { validateProjectIds } from "@/lib/userRelations";

const INVITATION_COLUMNS = `
  wi.invitation_id,
  wi.company_id,
  wi.email,
  wi.role_id,
  wi.team_id,
  wi.invited_by,
  wi.status,
  wi.expires_at,
  wi.accepted_at,
  wi.accepted_by,
  wi.revoked_at,
  wi.sent_at,
  wi.last_sent_at,
  wi.send_count,
  wi.created_at,
  wi.updated_at,
  r.role_name,
  r.role_key,
  t.name AS team_name,
  CONCAT_WS(' ', inviter.first_name, inviter.last_name) AS invited_by_name,
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'project_id', p.project_id,
        'project_name', p.project_name,
        'project_code', p.project_code
      ) ORDER BY p.project_name, p.project_id
    )
    FROM workspace_invitation_projects wip
    JOIN projects p ON p.project_id = wip.project_id
    WHERE wip.invitation_id = wi.invitation_id
  ), '[]'::jsonb) AS projects
`;

export async function GET(request: NextRequest) {
  const scope = await requirePermission(request, "PEOPLE_MANAGE");
  if (!scope.ok) return scope.response;

  const requestedStatus =
    request.nextUrl.searchParams.get("status") ?? "pending";
  if (
    !["all", "pending", "accepted", "expired", "revoked"].includes(
      requestedStatus,
    )
  ) {
    return NextResponse.json(
      { error: "Invalid invitation status" },
      { status: 400 },
    );
  }

  try {
    await pool.query(
      `UPDATE workspace_invitations
       SET status='expired', updated_at=CURRENT_TIMESTAMP
       WHERE company_id=$1 AND status='pending' AND expires_at <= CURRENT_TIMESTAMP`,
      [scope.context.access.company.company_id],
    );
    const values: unknown[] = [scope.context.access.company.company_id];
    const statusFilter = requestedStatus === "all" ? "" : "AND wi.status=$2";
    if (requestedStatus !== "all") values.push(requestedStatus);
    const result = await pool.query(
      `SELECT ${INVITATION_COLUMNS}
       FROM workspace_invitations wi
       JOIN roles r ON r.role_id=wi.role_id
       LEFT JOIN teams t ON t.team_id=wi.team_id
       JOIN users inviter ON inviter.user_id=wi.invited_by
       WHERE wi.company_id=$1 ${statusFilter}
       ORDER BY wi.created_at DESC`,
      values,
    );
    return NextResponse.json({ invitations: result.rows });
  } catch (error) {
    console.error("Failed to list invitations", error);
    return NextResponse.json(
      { error: "Unable to retrieve invitations" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const scope = await requireProjectAccessManager(request);
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
  if (!isObject(body) || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be an object" },
      { status: 400 },
    );
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const roleId = typeof body.role_id === "string" ? body.role_id : "";
  const teamId = typeof body.team_id === "string" ? body.team_id : "";
  const errors: string[] = [];
  const projectValidation = validateProjectIds({
    project_ids: body.project_ids ?? [],
  });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.push("A valid email is required");
  if (!isUuid(roleId)) errors.push("A valid role is required");
  if (!isUuid(teamId)) errors.push("A valid team is required");
  if (!projectValidation.ok) errors.push(...projectValidation.errors);
  if (errors.length) {
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  }
  if (!projectValidation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: projectValidation.errors },
      { status: 422 },
    );
  }

  const companyId = scope.context.access.company.company_id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const role = await client.query(
      "SELECT role_id, role_name, role_key FROM roles WHERE role_id=$1 AND is_active=TRUE",
      [roleId],
    );
    if (!role.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "The selected role is unavailable" },
        { status: 422 },
      );
    }
    const selectedRoleKey = String(role.rows[0].role_key);
    if (
      !isCompanyWideProjectRole(selectedRoleKey) &&
      projectValidation.projectIds.length === 0
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Select at least one project for this teammate" },
        { status: 422 },
      );
    }
    const actorRoleKey = scope.context.access.roleKey;
    const forbiddenRole =
      isSuperAdminRole(selectedRoleKey) && !isSuperAdminRole(actorRoleKey);
    if (forbiddenRole) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You cannot assign a role with greater access than your own" },
        { status: 403 },
      );
    }
    const team = await client.query(
      "SELECT team_id, name FROM teams WHERE team_id=$1 AND company_id=$2 AND is_active=TRUE",
      [teamId, companyId],
    );
    if (!team.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "The selected team is unavailable" },
        { status: 422 },
      );
    }
    let selectedProjects: Record<string, unknown>[] = [];
    if (projectValidation.projectIds.length > 0) {
      const projects = await client.query(
        `SELECT project_id, project_name, project_code
         FROM projects
         WHERE project_id = ANY($1::integer[])
           AND company_id = $2
           AND is_active = TRUE
         ORDER BY project_name, project_id`,
        [projectValidation.projectIds, companyId],
      );
      const found = new Set(
        projects.rows.map((project) => Number(project.project_id)),
      );
      const unavailable = projectValidation.projectIds.filter(
        (projectId) => !found.has(projectId),
      );
      if (unavailable.length) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "One or more selected projects are unavailable" },
          { status: 422 },
        );
      }
      selectedProjects = projects.rows;
    }
    const existingUser = await adminPool.query(
      `SELECT team.company_id
       FROM users existing_user
       JOIN teams team ON team.team_id = existing_user.team_id
       WHERE LOWER(existing_user.email)=LOWER($1)
         AND existing_user.deleted_at IS NULL
       LIMIT 1`,
      [email],
    );
    if (existingUser.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: invitationAccountConflictMessage(
            Number(existingUser.rows[0].company_id),
            companyId,
          ),
        },
        { status: 409 },
      );
    }
    await client.query(
      `UPDATE workspace_invitations
       SET status='expired', updated_at=CURRENT_TIMESTAMP
       WHERE company_id=$1 AND LOWER(email)=LOWER($2)
         AND status='pending' AND expires_at <= CURRENT_TIMESTAMP`,
      [companyId, email],
    );

    const companyAndInviter = await client.query(
      `SELECT c.company_name,
              CONCAT_WS(' ', u.first_name, u.last_name) AS inviter_name
       FROM companies c
       JOIN users u ON u.user_id=$2
       WHERE c.company_id=$1`,
      [companyId, scope.context.userId],
    );
    const { token, tokenHash } = createInvitationToken();
    const result = await client.query(
      `INSERT INTO workspace_invitations (
         company_id, email, role_id, team_id, invited_by, token_hash
       ) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING invitation_id, company_id, email, role_id, team_id, status,
         expires_at, created_at, updated_at`,
      [companyId, email, roleId, teamId, scope.context.userId, tokenHash],
    );
    const created = result.rows[0];
    if (projectValidation.projectIds.length > 0) {
      await client.query(
        `INSERT INTO workspace_invitation_projects (invitation_id, project_id)
         SELECT $1::uuid, project_id
         FROM unnest($2::integer[]) AS selected(project_id)`,
        [created.invitation_id, projectValidation.projectIds],
      );
    }
    await client.query("COMMIT");

    const link = invitationUrl(token, request.nextUrl.origin);
    const delivery = await sendInvitationEmail({
      email,
      companyName: String(
        companyAndInviter.rows[0]?.company_name ?? "your workspace",
      ),
      roleName: String(role.rows[0].role_name),
      teamName: String(team.rows[0].name),
      projectNames: isCompanyWideProjectRole(selectedRoleKey)
        ? []
        : selectedProjects.map((project) => String(project.project_name)),
      inviterName: String(companyAndInviter.rows[0]?.inviter_name ?? ""),
      invitationUrl: link,
      expiresAt: new Date(created.expires_at),
    });
    let deliveryFields: Record<string, unknown> = {};
    if (delivery.sent) {
      const deliveryResult = await pool
        .query(
          `UPDATE workspace_invitations
           SET sent_at=COALESCE(sent_at, CURRENT_TIMESTAMP),
               last_sent_at=CURRENT_TIMESTAMP,
               send_count=send_count+1,
               updated_at=CURRENT_TIMESTAMP
           WHERE invitation_id=$1
           RETURNING sent_at, last_sent_at, send_count, updated_at`,
          [created.invitation_id],
        )
        .catch((error) => {
          console.error("Failed to record invitation delivery", error);
          return null;
        });
      deliveryFields = deliveryResult?.rows[0] ?? {};
    }
    const invitation = {
      ...created,
      ...deliveryFields,
      role_name: role.rows[0].role_name,
      role_key: role.rows[0].role_key,
      team_name: team.rows[0].name,
      invited_by_name: companyAndInviter.rows[0]?.inviter_name ?? null,
      projects: selectedProjects,
    };
    return NextResponse.json(
      {
        message: delivery.sent
          ? "Invitation created and emailed"
          : "Invitation created, but the email could not be sent. Copy the link from Pending invitations.",
        invitation,
        invitation_url: link,
        email_sent: delivery.sent,
        delivery_error: delivery.sent ? undefined : delivery.error,
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (getDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "A pending invitation already exists for this email" },
        { status: 409 },
      );
    }
    console.error("Failed to create invitation", error);
    return NextResponse.json(
      { error: "Unable to create invitation" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
