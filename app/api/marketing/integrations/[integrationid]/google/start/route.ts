import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { googleMarketingAuthorizationUrl } from "@/lib/googleMarketing";
import { createSignedState } from "@/lib/oauthState";
import { requirePermission } from "@/lib/authorization";
import { isUuid } from "@/lib/permissions";

const COOKIE = "sthyra_marketing_oauth_state";
type Context = { params: Promise<{ integrationid: string }> };

export async function GET(request: NextRequest, context: Context) {
  const scope = await requirePermission(request, "WORKSPACE_MANAGE");
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects) return NextResponse.json({ error: "Company administrator access is required" }, { status: 403 });
  const integrationId = (await context.params).integrationid;
  if (!isUuid(integrationId)) return NextResponse.json({ error: "Invalid integration ID" }, { status: 400 });
  const integration = await pool.query(
    `SELECT integration_id FROM marketing_integrations
     WHERE company_id=$1 AND integration_id=$2 AND provider='google_data_manager'`,
    [scope.context.access.company.company_id, integrationId],
  );
  if (!integration.rowCount) return NextResponse.json({ error: "Integration not found" }, { status: 404 });
  try {
    const state = createSignedState({
      purpose: "google-marketing-oauth" as const,
      userId: scope.context.userId,
      companyId: scope.context.access.company.company_id,
      integrationId,
    });
    const response = NextResponse.redirect(googleMarketingAuthorizationUrl(request, state));
    response.cookies.set(COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/marketing/google/callback",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    console.error("Unable to start Google marketing OAuth", error);
    return NextResponse.json({ error: "Google marketing OAuth is not configured" }, { status: 503 });
  }
}
