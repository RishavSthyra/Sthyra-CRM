import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertLeadOpenForMutation,
  LeadReopenRequiredError,
  leadRequiresReopen,
} from "../lib/leadMutationPolicy";

test("invalid, duplicate and dead leads require reopening before mutation", () => {
  for (const status of ["invalid", "duplicate", "closed", " Invalid "]) {
    assert.equal(leadRequiresReopen(status), true);
  }
  for (const status of ["active", "nurture", "qualified", null]) {
    assert.equal(leadRequiresReopen(status), false);
  }
});

test("server mutation guard rejects terminal leads with a stable error code", async () => {
  const query = async () => ({
    rowCount: 1,
    rows: [{ status: "invalid" }],
  });

  await assert.rejects(
    assertLeadOpenForMutation(
      { query },
      { leadId: "lead-id", companyId: 1, projectId: 2 },
    ),
    (error: unknown) => {
      assert.ok(error instanceof LeadReopenRequiredError);
      assert.equal(error.code, "LEAD_REOPEN_REQUIRED");
      assert.equal(error.status, "invalid");
      return true;
    },
  );
});

test("server mutation guard permits active leads and ignores unlinked activity", async () => {
  let queryCount = 0;
  const query = async () => {
    queryCount += 1;
    return { rowCount: 1, rows: [{ status: "active" }] };
  };

  await assertLeadOpenForMutation(
    { query },
    { leadId: "lead-id", companyId: 1, projectId: 2 },
  );
  await assertLeadOpenForMutation(
    { query },
    { leadId: null, companyId: 1, projectId: 2 },
  );
  assert.equal(queryCount, 1);
});

test("all lead activity mutation APIs enforce the reopen policy", () => {
  const guardedRoutes = [
    "app/api/calls/route.ts",
    "app/api/calls/[callid]/disposition/route.ts",
    "app/api/emails/route.ts",
    "app/api/notes/route.ts",
  ];
  for (const path of guardedRoutes) {
    assert.match(readFileSync(path, "utf8"), /assertLeadOpenForMutation/);
  }

  for (const path of [
    "app/api/leads/[leadid]/contact/route.ts",
    "app/api/leads/[leadid]/next-action/route.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /leadRequiresReopen/);
    assert.match(source, /LEAD_REOPEN_REQUIRED/);
  }
});

test("lead drawer blocks mutations behind an explicit reopen confirmation", () => {
  const source = readFileSync("app/leads/page.tsx", "utf8");
  assert.match(source, /Reopen this lead\?/);
  assert.match(source, /requestLeadMutation\("call this lead"\)/);
  assert.match(source, /requestLeadMutation\("log a call"\)/);
  assert.match(source, /requestLeadMutation\("send an email"\)/);
  assert.match(source, /requestLeadMutation\("add a note"\)/);
  assert.match(source, /requestLeadMutation\("edit the contact profile"\)/);
});

test("duplicate leads can be reopened and lose their duplicate link", () => {
  const source = readFileSync(
    "app/api/leads/[leadid]/reopen/route.ts",
    "utf8",
  );
  assert.match(source, /"duplicate"/);
  assert.match(source, /duplicate_of_lead_id:\s*null/);
});
