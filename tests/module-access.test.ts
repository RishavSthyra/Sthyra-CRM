import assert from "node:assert/strict";
import test from "node:test";
import { canAccessWorkspaceModule } from "../lib/moduleAccess";

test("workspace modules are hidden without their permission", () => {
  const permissions = ["LEADS_VIEW", "LEADS_UPDATE"];
  assert.equal(
    canAccessWorkspaceModule("SALES_EXECUTIVE", permissions, "leads"),
    true,
  );
  assert.equal(
    canAccessWorkspaceModule("SALES_EXECUTIVE", permissions, "opportunities"),
    false,
  );
  assert.equal(
    canAccessWorkspaceModule("SALES_EXECUTIVE", permissions, "marketing"),
    false,
  );
});

test("explicit permissions reveal only their matching modules", () => {
  assert.equal(
    canAccessWorkspaceModule(
      "CUSTOM",
      ["OPPORTUNITIES_MANAGE"],
      "opportunities",
    ),
    true,
  );
  assert.equal(
    canAccessWorkspaceModule("CUSTOM", ["PEOPLE_MANAGE"], "people"),
    true,
  );
});

test("workspace administrators retain full module navigation", () => {
  assert.equal(
    canAccessWorkspaceModule("SUPER_ADMIN", [], "marketing"),
    true,
  );
  assert.equal(
    canAccessWorkspaceModule("SUPER_ADMIN", [], "opportunities"),
    true,
  );
  assert.equal(
    canAccessWorkspaceModule("COMPANY_OWNER", [], "marketing"),
    false,
  );
});
