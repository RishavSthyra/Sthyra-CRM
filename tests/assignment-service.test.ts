import assert from "node:assert/strict";
import test from "node:test";
import { assignmentNotificationTargets } from "../lib/assignmentService";

test("a direct assignment notifies only the assigned salesperson", () => {
  assert.deepEqual(
    assignmentNotificationTargets({
      userId: "user-1",
      teamId: "sales-team",
    }),
    { userIds: ["user-1"], teamIds: [] },
  );
});

test("a team assignment notifies the team when no user is selected", () => {
  assert.deepEqual(
    assignmentNotificationTargets({ teamId: "sales-team" }),
    { userIds: [], teamIds: ["sales-team"] },
  );
});
