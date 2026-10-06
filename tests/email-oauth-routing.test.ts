import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  mailboxOAuthCookieDomain,
  providerRedirectUri,
} from "../lib/email/oauthProviders";

const originalTenantRoot = process.env.TENANT_DOMAIN_ROOT;
const originalGoogleRedirect = process.env.GOOGLE_EMAIL_REDIRECT_URI;

test.beforeEach(() => {
  process.env.TENANT_DOMAIN_ROOT = "crm.sthyra.com";
  delete process.env.GOOGLE_EMAIL_REDIRECT_URI;
});

test.after(() => {
  if (originalTenantRoot === undefined) delete process.env.TENANT_DOMAIN_ROOT;
  else process.env.TENANT_DOMAIN_ROOT = originalTenantRoot;
  if (originalGoogleRedirect === undefined) {
    delete process.env.GOOGLE_EMAIL_REDIRECT_URI;
  } else {
    process.env.GOOGLE_EMAIL_REDIRECT_URI = originalGoogleRedirect;
  }
});

test("mailbox OAuth uses one central callback for every tenant", () => {
  const request = new NextRequest(
    "https://abhigna.crm.sthyra.com/api/email-connections/google/start",
  );

  assert.equal(
    providerRedirectUri(request, "google", "mailbox"),
    "https://crm.sthyra.com/api/email-connections/google/callback",
  );
  assert.equal(mailboxOAuthCookieDomain(request), ".crm.sthyra.com");
});

test("mailbox OAuth remains host-local during local development", () => {
  const request = new NextRequest(
    "http://localhost:3000/api/email-connections/google/start",
  );

  assert.equal(
    providerRedirectUri(request, "google", "mailbox"),
    "http://localhost:3000/api/email-connections/google/callback",
  );
  assert.equal(mailboxOAuthCookieDomain(request), undefined);
});

test("an explicit mailbox callback overrides the central tenant callback", () => {
  process.env.GOOGLE_EMAIL_REDIRECT_URI =
    "https://auth.example.com/google/callback";
  const request = new NextRequest(
    "https://nykaa.crm.sthyra.com/api/email-connections/google/start",
  );

  assert.equal(
    providerRedirectUri(request, "google", "mailbox"),
    "https://auth.example.com/google/callback",
  );
});

