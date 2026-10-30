import assert from "node:assert/strict";
import test from "node:test";
import {
  assignmentNotificationTargets,
  nextRoundRobinAssignee,
} from "../lib/assignmentService";

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

test("round robin advances through every queue member before wrapping", () => {
  const members = [
    { user_id: "nireeksha", position: 1 },
    { user_id: "aasma", position: 2 },
    { user_id: "nagesh", position: 3 },
  ];

  assert.equal(nextRoundRobinAssignee(members, null), "nireeksha");
  assert.equal(nextRoundRobinAssignee(members, "nireeksha"), "aasma");
  assert.equal(nextRoundRobinAssignee(members, "aasma"), "nagesh");
  assert.equal(nextRoundRobinAssignee(members, "nagesh"), "nireeksha");
});

test("round robin restarts safely when the previous member is unavailable", () => {
  assert.equal(
    nextRoundRobinAssignee(
      [
        { user_id: "aasma", position: 2 },
        { user_id: "nagesh", position: 3 },
      ],
      "nireeksha",
    ),
    "aasma",
  );
});
