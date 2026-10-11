import assert from "node:assert/strict";
import test from "node:test";
import {
  clearWorkspaceContextCache,
  getWorkspaceContext,
  isWorkspacePathname,
  type WorkspaceAccessContext,
} from "../lib/clientWorkspaceContext";

const context: WorkspaceAccessContext = {
  company: { company_id: 1, company_name: "Example" },
  team: null,
  role_key: "SALES_EXECUTIVE",
  can_view_all_projects: false,
  permissions: ["LEADS_VIEW"],
  projects: [
    {
      project_id: 10,
      project_code: "EXAMPLE",
      project_name: "Example Project",
    },
  ],
};

test("workspace context requests are deduplicated and cached", async (t) => {
  clearWorkspaceContextCache();
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify(context), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    clearWorkspaceContextCache();
  });

  const [first, second] = await Promise.all([
    getWorkspaceContext(),
    getWorkspaceContext(),
  ]);
  const third = await getWorkspaceContext();

  assert.equal(requests, 1);
  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(first.projects[0]?.project_name, "Example Project");
});

test("a forced refresh replaces the cached permission context", async (t) => {
  clearWorkspaceContextCache();
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(
      JSON.stringify({
        ...context,
        permissions: requests === 1 ? ["LEADS_VIEW"] : ["INVENTORY_MANAGE"],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    clearWorkspaceContextCache();
  });

  const initial = await getWorkspaceContext();
  const refreshed = await getWorkspaceContext({ force: true });

  assert.deepEqual(initial.permissions, ["LEADS_VIEW"]);
  assert.deepEqual(refreshed.permissions, ["INVENTORY_MANAGE"]);
  assert.equal(requests, 2);
});

test("only authenticated workspace routes trigger context loading", () => {
  assert.equal(isWorkspacePathname("/dashboard"), true);
  assert.equal(isWorkspacePathname("/inventory/unit-1"), true);
  assert.equal(isWorkspacePathname("/booking/token"), false);
  assert.equal(isWorkspacePathname("/quote/token"), false);
  assert.equal(isWorkspacePathname("/login"), false);
});
