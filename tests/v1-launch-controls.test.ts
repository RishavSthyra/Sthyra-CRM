import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, serializeCsv } from "../lib/dataTransfer";
import {
  normalizeWorkspaceSlug,
  tenantDomainForSlug,
} from "../lib/tenantDomains";
import {
  isTenantApplicationHostname,
  workspaceSlugFromHostname,
} from "../lib/tenantHost";
import {
  createTenantAuthContext,
  readTenantAuthContext,
} from "../lib/tenantRequestContext";
import { roleHasPermission } from "../lib/authorization";
import { hashRateLimitSubject } from "../lib/rateLimit";
import { invitationAccountConflictMessage } from "../lib/invitationPolicy";

test("CSV parser supports quoted commas and escaped quotes", () => {
  const rows = parseCsv(
    'first_name,email,notes\r\n"Rishav, Jr",r@example.com,"said ""hello"""',
  );
  assert.deepEqual(rows, [
    {
      first_name: "Rishav, Jr",
      email: "r@example.com",
      notes: 'said "hello"',
    },
  ]);
});

test("CSV export neutralizes spreadsheet formulas", () => {
  const csv = serializeCsv([{ name: "=WEBSERVICE(\"https://bad\")" }]);
  assert.match(csv, /'=WEBSERVICE/);
  assert.doesNotMatch(csv, /\r\n"=WEBSERVICE/);
});

test("workspace slugs are DNS safe and reserved names are avoided", () => {
  assert.equal(normalizeWorkspaceSlug("  Démo Heights Pvt. Ltd. "), "demo-heights-pvt-ltd");
  assert.equal(normalizeWorkspaceSlug("admin"), "admin-workspace");
  assert.match(normalizeWorkspaceSlug("***"), /^[a-z0-9][a-z0-9-]{0,62}$/);
});

test("tenant hostname uses the configured root", () => {
  const previous = process.env.TENANT_DOMAIN_ROOT;
  process.env.TENANT_DOMAIN_ROOT = "crm.sthyra.com";
  assert.equal(tenantDomainForSlug("Demo Company"), "demo-company.crm.sthyra.com");
  process.env.TENANT_DOMAIN_ROOT = previous;
});

test("tenant hostname resolves one workspace without confusing sibling hosts", () => {
  const previous = process.env.TENANT_DOMAIN_ROOT;
  process.env.TENANT_DOMAIN_ROOT = "crm.sthyra.com";
  assert.equal(workspaceSlugFromHostname("abhigna.crm.sthyra.com"), "abhigna");
  assert.equal(workspaceSlugFromHostname("nykaa.crm.sthyra.com"), "nykaa");
  assert.equal(workspaceSlugFromHostname("crm.sthyra.com"), null);
  assert.equal(workspaceSlugFromHostname("fake.example.com"), null);
  assert.equal(isTenantApplicationHostname("abhigna.crm.sthyra.com"), true);
  assert.equal(isTenantApplicationHostname("crm.sthyra.com"), true);
  assert.equal(isTenantApplicationHostname("fake.example.com"), false);
  process.env.TENANT_DOMAIN_ROOT = previous;
});

test("signed request context binds an auth user to its tenant hostname", () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "test-auth-secret-that-is-at-least-thirty-two-characters";
  const authUserId = "123e4567-e89b-12d3-a456-426614174000";
  const context = createTenantAuthContext(authUserId, "abhigna");
  assert.deepEqual(readTenantAuthContext(context), {
    authUserId,
    workspaceSlug: "abhigna",
  });
  assert.equal(readTenantAuthContext(context.replace("abhigna", "nykaa")), null);
  process.env.AUTH_SECRET = previous;
});

test("audit permission is available to company leadership roles", () => {
  assert.equal(roleHasPermission("SUPER_ADMIN", [], "AUDIT_VIEW"), true);
  assert.equal(roleHasPermission("COMPANY_OWNER", [], "AUDIT_VIEW"), true);
  assert.equal(roleHasPermission("COMPANY_ADMIN", [], "AUDIT_VIEW"), true);
  assert.equal(roleHasPermission("CUSTOM", ["AUDIT_VIEW"], "AUDIT_VIEW"), true);
  assert.equal(roleHasPermission("CUSTOM", ["DATA_EXPORT"], "DATA_EXPORT"), true);
  assert.equal(roleHasPermission("CUSTOM", [], "DATA_EXPORT"), false);
});

test("rate-limit subjects are deterministic keyed digests", () => {
  const previous = process.env.RATE_LIMIT_HASH_SECRET;
  process.env.RATE_LIMIT_HASH_SECRET = "test-secret-that-is-at-least-thirty-two-characters";
  const first = hashRateLimitSubject("Email:User@Example.com");
  const same = hashRateLimitSubject(" email:user@example.com ");
  const other = hashRateLimitSubject("email:other@example.com");
  assert.equal(first, same);
  assert.notEqual(first, other);
  assert.match(first, /^[a-f0-9]{64}$/);
  process.env.RATE_LIMIT_HASH_SECRET = previous;
});

test("invitation conflicts explain existing company membership", () => {
  assert.equal(
    invitationAccountConflictMessage(7, 7),
    "This account is already a member of this company. Sign in instead.",
  );
  assert.equal(
    invitationAccountConflictMessage(7, 12),
    "This account already belongs to another company and cannot join a second company yet.",
  );
});
