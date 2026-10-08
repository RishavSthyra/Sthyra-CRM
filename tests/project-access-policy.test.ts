import assert from "node:assert/strict";
import test from "node:test";
import {
  hasProjectWideLeadVisibility,
  isCompanyWideProjectRole,
  isLeadershipTeamName,
} from "../lib/projectAccessPolicy";
import { validateProjectIds } from "../lib/userRelations";

test("only administrative roles receive implicit company-wide project access", () => {
  assert.equal(isCompanyWideProjectRole("COMPANY_OWNER"), true);
  assert.equal(isCompanyWideProjectRole("company_admin"), true);
  assert.equal(isCompanyWideProjectRole("SALES_EXEC"), false);
});

test("lead visibility is project-wide only for trusted assignment scopes", () => {
  assert.equal(
    hasProjectWideLeadVisibility({
      roleKey: "SALES_EXEC",
      teamName: "Sales Team",
      permissions: ["LEADS_VIEW", "LEADS_UPDATE"],
    }),
    false,
  );
  assert.equal(
    hasProjectWideLeadVisibility({
      roleKey: "SALES_MANAGER",
      teamName: "Sales Team",
      permissions: ["LEADS_VIEW", "LEADS_ASSIGN"],
    }),
    true,
  );
  assert.equal(
    hasProjectWideLeadVisibility({
      roleKey: "FINANCE",
      teamName: "Leadership",
      permissions: ["LEADS_VIEW"],
    }),
    true,
  );
});

test("leadership team matching is case and whitespace insensitive", () => {
  assert.equal(isLeadershipTeamName(" Leadership "), true);
  assert.equal(isLeadershipTeamName("Sales Team"), false);
});

test("project selections accept unique positive integer IDs", () => {
  assert.deepEqual(validateProjectIds({ project_ids: [25, 31] }), {
    ok: true,
    projectIds: [25, 31],
  });
  assert.equal(validateProjectIds({ project_ids: [25, 25] }).ok, false);
  assert.equal(validateProjectIds({ project_ids: [0] }).ok, false);
});
