import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("shortlist creation rejects inventory that is not available", () => {
  const route = readFileSync(
    new URL(
      "../app/api/opportunities/[opportunityid]/shortlists/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    route,
    /String\(unit\.status\) !== "available"/,
    "the API must validate the current unit status",
  );
  assert.match(
    route,
    /Only available inventory can be added to a shortlist/,
    "the API should return a clear conflict message",
  );
  assert.match(
    route,
    /\{ status: 409 \}/,
    "unavailable inventory should be rejected as a conflict",
  );
});
