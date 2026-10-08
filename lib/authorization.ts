import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  OperationsContext,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { hasAuditLogAccess } from "@/lib/projectAccessPolicy";

const LEGACY_ADMIN_ROLES = new Set([
  "COMPANY_OWNER",
  "COMPANY_ADMIN",
  "SUPER_ADMIN",
]);

export async function getUserPermissionKeys(userId: string): Promise<string[]> {
  const result = await pool.query<{ permission_key: string }>(
    `SELECT DISTINCT permission.permission_key
     FROM users app_user
     JOIN roles role ON role.role_id = app_user.role_id
     JOIN role_permissions role_permission ON role_permission.role_id = role.role_id
     JOIN permissions permission ON permission.permission_id = role_permission.permission_id
     WHERE app_user.user_id = $1
       AND app_user.is_active = TRUE
       AND role.is_active = TRUE
     ORDER BY permission.permission_key`,
    [userId],
  );
  return result.rows.map((row) => row.permission_key);
}

export function roleHasPermission(
  roleKey: string,
  permissionKeys: readonly string[],
  requiredPermission: string,
): boolean {
  if (roleKey === "SUPER_ADMIN") return true;
  return (
    LEGACY_ADMIN_ROLES.has(roleKey) || permissionKeys.includes(requiredPermission)
  );
}

export type PermissionContextResult =
  | {
      ok: true;
      context: OperationsContext & { permissions: string[] };
    }
  | { ok: false; response: NextResponse };

export async function requirePermission(
  request: NextRequest,
  permission: string,
): Promise<PermissionContextResult> {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope;
  const permissions = await getUserPermissionKeys(scope.context.userId);
  if (!roleHasPermission(scope.context.access.roleKey, permissions, permission)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Missing required permission: ${permission}` },
        { status: 403 },
      ),
    };
  }
  return { ok: true, context: { ...scope.context, permissions } };
}

export async function requireSuperAdmin(
  request: NextRequest,
): Promise<PermissionContextResult> {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope;
  if (scope.context.access.roleKey !== "SUPER_ADMIN") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Super admin access is required" },
        { status: 403 },
      ),
    };
  }
  const permissions = await getUserPermissionKeys(scope.context.userId);
  return { ok: true, context: { ...scope.context, permissions } };
}

export async function requireAuditLogAccess(
  request: NextRequest,
): Promise<PermissionContextResult> {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope;
  if (
    !hasAuditLogAccess({
      roleKey: scope.context.access.roleKey,
      teamName: scope.context.access.team.team_name,
    })
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Leadership access is required" },
        { status: 403 },
      ),
    };
  }
  const permissions = await getUserPermissionKeys(scope.context.userId);
  return { ok: true, context: { ...scope.context, permissions } };
}
