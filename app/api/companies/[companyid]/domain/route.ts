import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/authorization";
import { provisionTenantDomain } from "@/lib/tenantDomains";

type CompanyDomainContext = {
  params: Promise<{ companyid: string }>;
};

async function resolveCompany(
  request: NextRequest,
  context: CompanyDomainContext,
) {
  const scope = await requirePermission(request, "WORKSPACE_MANAGE");
  if (!scope.ok) return scope;
  const { companyid } = await context.params;
  const companyId = Number(companyid);
  if (
    !Number.isSafeInteger(companyId) ||
    companyId < 1 ||
    companyId !== scope.context.access.company.company_id
  ) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Company not found" }, { status: 404 }),
    };
  }
  const result = await pool.query(
    `SELECT company_id, workspace_slug, workspace_domain,
            workspace_domain_status, workspace_domain_error,
            workspace_domain_updated_at
     FROM companies WHERE company_id = $1`,
    [companyId],
  );
  if (!result.rowCount || !result.rows[0].workspace_domain) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "This company does not have a workspace domain" },
        { status: 404 },
      ),
    };
  }
  return { ok: true as const, company: result.rows[0] };
}

export async function GET(request: NextRequest, context: CompanyDomainContext) {
  const result = await resolveCompany(request, context);
  if (!result.ok) return result.response;
  return NextResponse.json({ domain: result.company });
}

export async function POST(request: NextRequest, context: CompanyDomainContext) {
  const result = await resolveCompany(request, context);
  if (!result.ok) return result.response;
  const provisioned = await provisionTenantDomain(
    Number(result.company.company_id),
    String(result.company.workspace_domain),
  );
  return NextResponse.json({
    message:
      provisioned.status === "active"
        ? "Workspace domain is active"
        : provisioned.status === "pending"
          ? "Workspace domain is ready to provision after Vercel credentials are configured"
          : "Workspace domain provisioning failed; retry is available",
    domain: provisioned,
  });
}
