import { NextRequest, NextResponse } from "next/server";
import type { QueryResult } from "pg";
import pool from "@/lib/db";
import { requireLeadVisibility } from "@/lib/leadVisibility";
import { canAccessProject } from "@/lib/projectAccess";
import { parsePagination } from "@/utils/parsePagination";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

export async function GET(request: NextRequest) {
  const scope = await requireLeadVisibility(request, "LEADS_ASSIGN");
  if (!scope.ok) return scope.response;

  const projectId = parsePositiveInteger(
    request.nextUrl.searchParams.get("project_id"),
  );
  const subjectType = request.nextUrl.searchParams.get("subject_type");
  if (!projectId || !canAccessProject(scope.context.access, projectId))
    return NextResponse.json(
      { error: "Invalid or inaccessible project_id" },
      { status: 400 },
    );
  if (subjectType !== "lead" && subjectType !== "opportunity")
    return NextResponse.json(
      { error: "subject_type must be lead or opportunity" },
      { status: 400 },
    );
  const pagination = parsePagination(request.nextUrl.searchParams, 10, 100);
  if (!pagination.ok)
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  const search = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (search.length > 200)
    return NextResponse.json(
      { error: "q must be at most 200 characters" },
      { status: 400 },
    );

  try {
    let subjects: QueryResult;
    let total = 0;
    let transferableTotal = 0;
    if (subjectType === "lead") {
      const values: unknown[] = [
        projectId,
        scope.context.leadVisibility.canViewProjectWide,
        scope.context.leadVisibility.userId,
        scope.context.leadVisibility.teamId,
      ];
      const filters = [
        "l.project_id=$1",
        "l.status IN ('active','nurture')",
        "($2::boolean=TRUE OR l.current_owner_user_id=$3 OR l.current_team_id=$4)",
      ];
      if (search) {
        values.push(`%${search}%`);
        const parameter = `$${values.length}`;
        filters.push(`(
          BTRIM(CONCAT_WS(' ', c.first_name, c.last_name)) ILIKE ${parameter}
          OR c.email ILIKE ${parameter}
          OR c.phone_number ILIKE ${parameter}
          OR stage.stage_name ILIKE ${parameter}
          OR BTRIM(CONCAT_WS(' ', owner.first_name, owner.last_name)) ILIKE ${parameter}
          OR owner_team.name ILIKE ${parameter}
        )`);
      }
      const where = `WHERE ${filters.join(" AND ")}`;
      const count = await pool.query(
        `SELECT COUNT(*)::integer AS total,
           COUNT(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM transfers transfer
             WHERE transfer.lead_id=l.lead_id
               AND transfer.status IN ('draft','validated','submitted')
           ))::integer AS transferable_total
         FROM leads l
         JOIN contacts c ON c.contact_id=l.contact_id
         LEFT JOIN project_lead_stages stage ON stage.stage_id=l.stage_id
         LEFT JOIN users owner ON owner.user_id=l.current_owner_user_id
         LEFT JOIN teams owner_team ON owner_team.team_id=l.current_team_id
         ${where}`,
        values,
      );
      total = Number(count.rows[0]?.total ?? 0);
      transferableTotal = Number(count.rows[0]?.transferable_total ?? 0);
      const listValues = [...values, pagination.limit, pagination.offset];
      subjects = await pool.query(
        `SELECT l.lead_id AS subject_id,
               BTRIM(CONCAT_WS(' ', c.first_name, c.last_name)) AS subject_name,
               c.email, c.phone_number, l.status, l.temperature,
               stage.stage_name,
               l.current_owner_user_id, l.current_team_id,
               owner.first_name AS owner_first_name,
               owner.last_name AS owner_last_name,
               owner_team.name AS owner_team_name,
               active_transfer.transfer_id AS active_transfer_id,
               active_transfer.status AS active_transfer_status
             FROM leads l
             JOIN contacts c ON c.contact_id=l.contact_id
             LEFT JOIN project_lead_stages stage ON stage.stage_id=l.stage_id
             LEFT JOIN users owner ON owner.user_id=l.current_owner_user_id
             LEFT JOIN teams owner_team ON owner_team.team_id=l.current_team_id
             LEFT JOIN LATERAL (
               SELECT transfer_id, status
               FROM transfers transfer
               WHERE transfer.lead_id=l.lead_id
                 AND transfer.status IN ('draft','validated','submitted')
               LIMIT 1
             ) active_transfer ON TRUE
             ${where}
             ORDER BY l.updated_at DESC, l.lead_id DESC
             LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
        listValues,
      );
    } else {
      const values: unknown[] = [
        projectId,
        scope.context.leadVisibility.canViewProjectWide,
        scope.context.leadVisibility.userId,
        scope.context.leadVisibility.teamId,
      ];
      const filters = [
        "o.project_id=$1",
        "o.status='open'",
        "($2::boolean=TRUE OR o.current_owner_user_id=$3 OR o.current_team_id=$4)",
        `NOT EXISTS (
          SELECT 1 FROM transfers transfer
          WHERE transfer.opportunity_id=o.opportunity_id
            AND transfer.status IN ('draft','validated','submitted')
        )`,
      ];
      if (search) {
        values.push(`%${search}%`);
        const parameter = `$${values.length}`;
        filters.push(`(
          o.opportunity_name ILIKE ${parameter}
          OR c.email ILIKE ${parameter}
          OR stage.stage_name ILIKE ${parameter}
          OR BTRIM(CONCAT_WS(' ', owner.first_name, owner.last_name)) ILIKE ${parameter}
          OR owner_team.name ILIKE ${parameter}
        )`);
      }
      const where = `WHERE ${filters.join(" AND ")}`;
      const joins = `
        FROM opportunities o
        JOIN contacts c ON c.contact_id=o.contact_id
        LEFT JOIN project_opportunity_stages stage
          ON stage.project_id=o.project_id
         AND stage.stage_key=o.stage_key
         AND stage.is_active=TRUE
        LEFT JOIN users owner ON owner.user_id=o.current_owner_user_id
        LEFT JOIN teams owner_team ON owner_team.team_id=o.current_team_id`;
      const count = await pool.query(
        `SELECT COUNT(*)::integer AS total ${joins} ${where}`,
        values,
      );
      total = Number(count.rows[0]?.total ?? 0);
      transferableTotal = total;
      const listValues = [...values, pagination.limit, pagination.offset];
      subjects = await pool.query(
        `SELECT o.opportunity_id AS subject_id,
               o.opportunity_name AS subject_name, c.email, o.status,
               stage.stage_name,
               o.current_owner_user_id, o.current_team_id,
               owner.first_name AS owner_first_name,
               owner.last_name AS owner_last_name,
               owner_team.name AS owner_team_name
             ${joins}
             ${where}
             ORDER BY o.updated_at DESC, o.opportunity_id DESC
             LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
        listValues,
      );
    }

    const [users, teams, templates] = await Promise.all([
      pool.query(
        `SELECT u.user_id, u.first_name, u.last_name, u.email,
           u.team_id, team.name AS team_name
         FROM users u
         JOIN teams team ON team.team_id=u.team_id
         JOIN roles role ON role.role_id=u.role_id
         WHERE team.company_id=$1 AND u.is_active=TRUE
           AND u.deleted_at IS NULL AND team.is_active=TRUE
           AND role.is_active=TRUE
           AND (
             role.role_key = 'SUPER_ADMIN'
             OR EXISTS (
               SELECT 1 FROM user_projects user_project
               WHERE user_project.user_id=u.user_id
                 AND user_project.project_id=$2
             )
             OR EXISTS (
               SELECT 1 FROM team_projects team_project
               WHERE team_project.team_id=u.team_id
                 AND team_project.project_id=$2
             )
           )
         ORDER BY u.first_name, u.last_name, u.user_id`,
        [scope.context.access.company.company_id, projectId],
      ),
      pool.query(
        `SELECT team.team_id, team.name AS team_name, team.team_type
         FROM teams team
         WHERE team.company_id=$1 AND team.is_active=TRUE
           AND EXISTS (
             SELECT 1 FROM team_projects team_project
             WHERE team_project.team_id=team.team_id
               AND team_project.project_id=$2
           )
         ORDER BY team.name, team.team_id`,
        [scope.context.access.company.company_id, projectId],
      ),
      pool.query(
        `SELECT template.template_id, template.template_name,
           template.description, template.project_id, template.applies_to,
           COUNT(item.item_id)::integer AS item_count
         FROM transfer_checklist_templates template
         LEFT JOIN transfer_checklist_template_items item
           ON item.template_id=template.template_id
         WHERE template.company_id=$1 AND template.is_active=TRUE
           AND (template.project_id=$2 OR template.project_id IS NULL)
           AND template.applies_to IN ($3,'both')
         GROUP BY template.template_id
         ORDER BY (template.project_id IS NOT NULL) DESC,
           template.updated_at DESC`,
        [scope.context.access.company.company_id, projectId, subjectType],
      ),
    ]);

    return NextResponse.json({
      subjects: subjects.rows,
      users: users.rows,
      teams: teams.rows,
      templates: templates.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
        transferableTotal,
        unavailableTotal: total - transferableTotal,
      },
    });
  } catch (error) {
    console.error("Failed to retrieve transfer options", error);
    return NextResponse.json(
      { error: "Unable to retrieve transfer options" },
      { status: 500 },
    );
  }
}
