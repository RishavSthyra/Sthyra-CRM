import pool from "@/lib/db";

const COMPANY_WIDE_PROJECT_ROLES = new Set([
  "COMPANY_OWNER",
  "COMPANY_ADMIN",
  "SUPER_ADMIN",
]);

export type AccessibleProject = {
  project_id: number;
  project_code: string;
  project_name: string;
  project_status: string;
  project_type: string;
};

export type UserProjectAccess = {
  company: {
    company_id: number;
    company_code: string;
    company_name: string;
  };
  roleKey: string;
  canViewAllProjects: boolean;
  projects: AccessibleProject[];
};

export async function getUserProjectAccess(
  userId: string,
): Promise<UserProjectAccess | null> {
  const userContext = await pool.query(
    `SELECT
       c.company_id,
       c.company_code,
       c.company_name,
       r.role_key,
       u.team_id
     FROM users u
     JOIN teams t ON t.team_id = u.team_id
     JOIN companies c ON c.company_id = t.company_id
     JOIN roles r ON r.role_id = u.role_id
     WHERE u.user_id = $1
       AND u.is_active = TRUE
       AND u.deleted_at IS NULL
       AND t.is_active = TRUE
       AND c.archived_at IS NULL
       AND r.is_active = TRUE`,
    [userId],
  );

  if (!userContext.rowCount) return null;

  const row = userContext.rows[0] as {
    company_id: number;
    company_code: string;
    company_name: string;
    role_key: string;
    team_id: string;
  };
  const canViewAllProjects = COMPANY_WIDE_PROJECT_ROLES.has(row.role_key);
  const projects = await pool.query(
    `SELECT
       p.project_id,
       p.project_code,
       p.project_name,
       p.project_status,
       p.project_type
     FROM projects p
     WHERE p.company_id = $1
       AND p.is_active = TRUE
       AND (
         $2::boolean = TRUE
         OR EXISTS (
           SELECT 1
           FROM user_projects up
           WHERE up.user_id = $3 AND up.project_id = p.project_id
         )
         OR EXISTS (
           SELECT 1
           FROM team_projects tp
           WHERE tp.team_id = $4 AND tp.project_id = p.project_id
         )
       )
     ORDER BY p.project_name ASC, p.project_id ASC`,
    [row.company_id, canViewAllProjects, userId, row.team_id],
  );

  return {
    company: {
      company_id: Number(row.company_id),
      company_code: row.company_code,
      company_name: row.company_name,
    },
    roleKey: row.role_key,
    canViewAllProjects,
    projects: projects.rows.map((project) => ({
      project_id: Number(project.project_id),
      project_code: String(project.project_code),
      project_name: String(project.project_name),
      project_status: String(project.project_status),
      project_type: String(project.project_type),
    })),
  };
}

export function canAccessProject(
  access: UserProjectAccess,
  projectId: number,
): boolean {
  return access.projects.some((project) => project.project_id === projectId);
}

export function getAccessibleProjectIds(access: UserProjectAccess): number[] {
  return access.projects.map((project) => project.project_id);
}
