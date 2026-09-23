import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import {
  canAccessProject,
  getUserProjectAccess,
  UserProjectAccess,
} from "@/lib/projectAccess";

export type OperationsContext = {
  userId: string;
  access: UserProjectAccess;
};

export type OperationsContextResult =
  | { ok: true; context: OperationsContext }
  | { ok: false; response: NextResponse };

export async function requireOperationsContext(
  request: NextRequest,
): Promise<OperationsContextResult> {
  const authentication = await authenticateRequest(request);
  if (!authentication.ok) return authentication;

  try {
    const access = await getUserProjectAccess(authentication.auth.user.user_id);
    if (!access) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Your account is not connected to an active company" },
          { status: 403 },
        ),
      };
    }
    return {
      ok: true,
      context: {
        userId: authentication.auth.user.user_id,
        access,
      },
    };
  } catch (error) {
    console.error("Failed to resolve operations access", error);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unable to resolve access" },
        { status: 500 },
      ),
    };
  }
}

export function canAccessOperationsEntity(
  access: UserProjectAccess,
  companyId: number,
  projectId: number | null,
): boolean {
  return (
    companyId === access.company.company_id &&
    (projectId === null || canAccessProject(access, projectId))
  );
}
