import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const invitationRoute = readFileSync(
  new URL("../app/api/invitations/route.ts", import.meta.url),
  "utf8",
);
const repairMigration = readFileSync(
  new URL(
    "../database/migrations/20261030_repair_workspace_invitation_delivery_columns.sql",
    import.meta.url,
  ),
  "utf8",
);

test("invitation repair migration supplies every delivery column used by the list API", () => {
  for (const column of [
    "revoked_by",
    "sent_at",
    "last_sent_at",
    "send_count",
  ]) {
    assert.match(repairMigration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }

  for (const selectedColumn of ["sent_at", "last_sent_at", "send_count"]) {
    assert.match(invitationRoute, new RegExp(`wi\\.${selectedColumn}`));
  }
});

test("invitation delivery count remains non-negative", () => {
  assert.match(
    repairMigration,
    /CHECK \(send_count >= 0\)/,
  );
});
