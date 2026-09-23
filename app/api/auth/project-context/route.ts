import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { getUserProjectAccess } from "@/lib/projectAccess";

export async function GET(request: NextRequest) {
  const authentication = await authenticateRequest(request);
  if (!authentication.ok) return authentication.response;

  try {

    const access = await getUserProjectAccess(authentication.auth.user.user_id);
    
    if (!access) {
      return NextResponse.json(
        { error: "Your account is not connected to an active company" },
        { status: 403 },
      );
    }

    const response = NextResponse.json({
      company: access.company,
      role_key: access.roleKey,
      can_view_all_projects: access.canViewAllProjects,
      projects: access.projects,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Failed to retrieve project context", error);
    return NextResponse.json(
      { error: "Unable to retrieve project context" },
      { status: 500 },
    );
  }
}
