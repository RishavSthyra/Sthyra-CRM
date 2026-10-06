import type { PoolClient } from "pg";
import { adminPool } from "@/lib/db";
import { tenantDomainRootValue } from "@/lib/tenantHost";

const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "crm",
  "login",
  "mail",
  "support",
  "www",
]);

export function normalizeWorkspaceSlug(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  const fallback = normalized || "workspace";
  return RESERVED_SLUGS.has(fallback) ? `${fallback}-workspace` : fallback;
}

export function tenantDomainForSlug(slug: string): string {
  return `${normalizeWorkspaceSlug(slug)}.${tenantDomainRootValue()}`;
}

export async function createAvailableWorkspaceIdentity(
  client: Pick<PoolClient, "query">,
  preferred: string,
): Promise<{ slug: string; domain: string }> {
  const base = normalizeWorkspaceSlug(preferred).slice(0, 54);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const slug = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const result = await client.query(
      `SELECT 1 FROM companies
       WHERE LOWER(workspace_slug) = LOWER($1)
          OR LOWER(workspace_domain) = LOWER($2)
       LIMIT 1`,
      [slug, tenantDomainForSlug(slug)],
    );
    if (!result.rowCount) return { slug, domain: tenantDomainForSlug(slug) };
  }
  throw new Error("Unable to allocate a unique workspace domain");
}

type VercelDomainResponse = {
  name?: string;
  verified?: boolean;
  error?: { code?: string; message?: string };
};

export async function addDomainToVercelProject(domain: string): Promise<{
  configured: boolean;
  verified: boolean;
}> {
  const token = process.env.VERCEL_TOKEN?.trim();
  const project = process.env.VERCEL_PROJECT_ID?.trim();
  if (!token || !project) return { configured: false, verified: false };

  const endpoint = new URL(
    `https://api.vercel.com/v10/projects/${encodeURIComponent(project)}/domains`,
  );
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  if (teamId) endpoint.searchParams.set("teamId", teamId);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: domain }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => ({}))) as VercelDomainResponse;
  if (!response.ok) {
    const code = payload.error?.code?.toLowerCase() ?? "";
    const message = payload.error?.message ?? "";
    const alreadyOnProject =
      code.includes("already_exists") || /already.+(?:this|the).+project/i.test(message);
    if (!alreadyOnProject) {
      throw new Error(payload.error?.message || `Vercel returned ${response.status}`);
    }
  }
  return { configured: true, verified: payload.verified !== false };
}

export async function provisionTenantDomain(
  companyId: number,
  domain: string,
): Promise<{ domain: string; status: "pending" | "active" | "error" }> {
  try {
    await adminPool.query(
      `UPDATE companies
       SET workspace_domain_status = 'provisioning',
           workspace_domain_error = NULL,
           workspace_domain_updated_at = CURRENT_TIMESTAMP
       WHERE company_id = $1`,
      [companyId],
    );
    const result = await addDomainToVercelProject(domain);
    const status = result.configured && result.verified ? "active" : "pending";
    await adminPool.query(
      `UPDATE companies
       SET workspace_domain_status = $2,
           workspace_domain_error = NULL,
           workspace_domain_updated_at = CURRENT_TIMESTAMP
       WHERE company_id = $1`,
      [companyId, status],
    );
    return { domain, status };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2000) : "Unknown provisioning error";
    await adminPool
      .query(
        `UPDATE companies
         SET workspace_domain_status = 'error',
             workspace_domain_error = $2,
             workspace_domain_updated_at = CURRENT_TIMESTAMP
         WHERE company_id = $1`,
        [companyId, message],
      )
      .catch((updateError) =>
        console.error("Unable to record tenant-domain failure", updateError),
      );
    return { domain, status: "error" };
  }
}
