function tenantDomainRoot(): string {
  const root =
    process.env.TENANT_DOMAIN_ROOT?.trim().toLowerCase() || "crm.sthyra.com";
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      root,
    )
  ) {
    throw new Error("TENANT_DOMAIN_ROOT is not a valid domain");
  }
  return root;
}

export function workspaceSlugFromHostname(hostname: string): string | null {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/\.$/, "");
  const root = tenantDomainRoot();
  if (normalizedHostname === root) return null;

  const suffix = `.${root}`;
  if (!normalizedHostname.endsWith(suffix)) return null;
  const candidate = normalizedHostname.slice(0, -suffix.length);
  if (
    candidate.includes(".") ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

export function tenantDomainRootValue(): string {
  return tenantDomainRoot();
}

export function isTenantApplicationHostname(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/\.$/, "");
  return (
    normalizedHostname === tenantDomainRoot() ||
    workspaceSlugFromHostname(normalizedHostname) !== null
  );
}
