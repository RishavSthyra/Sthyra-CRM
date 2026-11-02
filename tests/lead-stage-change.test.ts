import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateManualLeadStageTransition,
  getManualStageDirection,
  isCommandManagedLeadStage,
} from "../lib/manualLeadStageTransition";

const currentStage = {
  stage_key: "contact_attempted",
  stage_name: "Contact Attempted",
  position: 2,
  is_terminal: false,
};

test("manual stage direction is stable for ordered and missing stages", () => {
  assert.equal(getManualStageDirection(2, 3), "forward");
  assert.equal(getManualStageDirection(2, 1), "backward");
  assert.equal(getManualStageDirection(2, 2), "same");
  assert.equal(getManualStageDirection(undefined, 2), "unknown");
  assert.equal(getManualStageDirection(null, 2), "unknown");
  assert.equal(getManualStageDirection(2, null), "unknown");
  assert.equal(getManualStageDirection(2, "invalid"), "unknown");
});

test("ordinary forward transitions are allowed", () => {
  assert.deepEqual(
    evaluateManualLeadStageTransition({
      currentStage,
      targetStage: {
        stage_key: "contacted",
        stage_name: "Contacted",
        position: 3,
      },
      canMoveBackward: false,
    }),
    { ok: true, direction: "forward" },
  );
});

test("backward corrections require project management permission", () => {
  const targetStage = {
    stage_key: "new",
    stage_name: "New",
    position: 1,
  };
  const denied = evaluateManualLeadStageTransition({
    currentStage,
    targetStage,
    canMoveBackward: false,
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.status, 403);
    assert.match(denied.error, /project management permission/i);
  }
  assert.deepEqual(
    evaluateManualLeadStageTransition({
      currentStage,
      targetStage,
      canMoveBackward: true,
    }),
    { ok: true, direction: "backward" },
  );
});

test("same, terminal and command-managed stages cannot use the generic action", () => {
  const same = evaluateManualLeadStageTransition({
    currentStage,
    targetStage: currentStage,
    canMoveBackward: true,
  });
  assert.equal(same.ok, false);
  if (!same.ok) assert.equal(same.status, 409);

  for (const stage_key of ["qualified", "nurturing"]) {
    assert.equal(isCommandManagedLeadStage(stage_key), true);
    const result = evaluateManualLeadStageTransition({
      currentStage,
      targetStage: { stage_key, position: 5 },
      canMoveBackward: true,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 422);
  }

  const terminal = evaluateManualLeadStageTransition({
    currentStage,
    targetStage: {
      stage_key: "closed",
      position: 6,
      is_terminal: true,
    },
    canMoveBackward: true,
  });
  assert.equal(terminal.ok, false);
  if (!terminal.ok) assert.match(terminal.error, /close action/i);
});

test("100,000 transition evaluations preserve all safety invariants", () => {
  let allowed = 0;
  let denied = 0;
  for (let index = 0; index < 100_000; index += 1) {
    const currentPosition = (index % 8) + 1;
    const targetPosition = ((index * 7) % 8) + 1;
    const result = evaluateManualLeadStageTransition({
      currentStage: {
        stage_key: `stage_${currentPosition}`,
        position: currentPosition,
      },
      targetStage: {
        stage_key: `stage_${targetPosition}`,
        position: targetPosition,
      },
      canMoveBackward: index % 3 === 0,
    });
    if (result.ok) {
      allowed += 1;
      assert.notEqual(result.direction, "same");
    } else {
      denied += 1;
      assert.ok([403, 409].includes(result.status));
    }
  }
  assert.equal(allowed + denied, 100_000);
  assert.ok(allowed > 0);
  assert.ok(denied > 0);
});

test("lead stage UI uses a project-aware dialog instead of an internal-key prompt", () => {
  const page = readFileSync("app/leads/page.tsx", "utf8");
  const dialog = readFileSync(
    "components/leads/ChangeLeadStageDialog.tsx",
    "utf8",
  );

  assert.doesNotMatch(page, /Enter the project stage key/);
  assert.match(page, /`\/api\/projects\/\$\{projectId\}\/lead-stages`/);
  assert.match(page, /<ChangeLeadStageDialog/);
  assert.match(dialog, /Current stage/);
  assert.match(dialog, /Reason/);
  assert.match(dialog, /manager permission required/);
  assert.match(dialog, /isCommandManagedLeadStage/);
});

test("stage APIs enforce tenant access, update permission and workflow commands", () => {
  const changeRoute = readFileSync(
    "app/api/leads/[leadid]/change-stage/route.ts",
    "utf8",
  );
  const stagesRoute = readFileSync(
    "app/api/projects/[projectid]/lead-stages/route.ts",
    "utf8",
  );

  assert.match(changeRoute, /requirePermission\(request, "LEADS_UPDATE"\)/);
  assert.match(changeRoute, /canAccessOperationsEntity/);
  assert.match(changeRoute, /evaluateManualLeadStageTransition/);
  assert.match(changeRoute, /"PROJECTS_MANAGE"/);
  assert.match(stagesRoute, /requireOperationsContext/);
  assert.match(stagesRoute, /requirePermission\(request, "PROJECTS_MANAGE"\)/);
  assert.match(stagesRoute, /canAccessProject/);
});

