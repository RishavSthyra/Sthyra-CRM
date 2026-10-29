import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { roleHasPermission } from "../lib/authorization";

const taskRoute = readFileSync(
  new URL("../app/api/tasks/[taskid]/route.ts", import.meta.url),
  "utf8",
);
const taskActions = readFileSync(
  new URL("../lib/taskActions.ts", import.meta.url),
  "utf8",
);
const taskListRoute = readFileSync(
  new URL("../app/api/tasks/route.ts", import.meta.url),
  "utf8",
);
const taskBoard = readFileSync(
  new URL("../components/activity/ActivityTabViews.tsx", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../database/migrations/20261029_add_task_edit_delete_permissions.sql",
    import.meta.url,
  ),
  "utf8",
);

test("task edit and delete are independent explicit permissions", () => {
  assert.equal(
    roleHasPermission("CUSTOM", ["ACTIVITIES_MANAGE"], "ACTIVITIES_EDIT"),
    false,
  );
  assert.equal(
    roleHasPermission("CUSTOM", ["ACTIVITIES_EDIT"], "ACTIVITIES_EDIT"),
    true,
  );
  assert.equal(
    roleHasPermission("CUSTOM", ["ACTIVITIES_EDIT"], "ACTIVITIES_DELETE"),
    false,
  );
  assert.equal(
    roleHasPermission("SUPER_ADMIN", [], "ACTIVITIES_DELETE"),
    true,
  );
});

test("task mutations enforce permissions on the backend", () => {
  assert.match(
    taskRoute,
    /requirePermission\(request, "ACTIVITIES_EDIT"\)/,
  );
  assert.match(
    taskRoute,
    /requirePermission\(request, "ACTIVITIES_DELETE"\)/,
  );
  assert.match(taskRoute, /export async function DELETE/);
  assert.match(
    taskActions,
    /requirePermission\(request, "ACTIVITIES_EDIT"\)/,
  );
});

test("deleted tasks leave the board but retain their audit record", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ/);
  assert.match(migration, /ACTIVITIES_EDIT/);
  assert.match(migration, /ACTIVITIES_DELETE/);
  assert.match(taskListRoute, /t\.deleted_at IS NULL/);
  assert.match(taskRoute, /"task_deleted"/);
  assert.doesNotMatch(taskRoute, /DELETE FROM tasks/);
});

test("task board exposes permission-aware edit and delete controls", () => {
  assert.match(taskBoard, /canEdit: boolean/);
  assert.match(taskBoard, /canDelete: boolean/);
  assert.match(taskBoard, /Edit task/);
  assert.match(taskBoard, /Delete task/);
  assert.match(taskBoard, /method: "DELETE"/);
  assert.match(taskBoard, /method: editingTask \? "PATCH" : "POST"/);
});
