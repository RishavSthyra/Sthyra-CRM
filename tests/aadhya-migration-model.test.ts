import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMigrationPlan,
  normalizeIndianPhone,
  splitName,
  unwrapExtendedJson,
} from "../scripts/lib/aadhya-migration-model";

test("normalizes supported Indian phone formats", () => {
  assert.equal(normalizeIndianPhone("98765 43210"), "+919876543210");
  assert.equal(normalizeIndianPhone("+91-98765-43210"), "+919876543210");
  assert.equal(normalizeIndianPhone("not supplied"), null);
});

test("unwraps MongoDB extended JSON recursively", () => {
  assert.deepEqual(
    unwrapExtendedJson({
      _id: { $oid: "abc" },
      createdAt: { $date: "2026-10-01T00:00:00.000Z" },
      nested: [{ count: { $numberInt: "2" } }],
    }),
    {
      _id: "abc",
      createdAt: "2026-10-01T00:00:00.000Z",
      nested: [{ count: 2 }],
    },
  );
});

test("splits a display name without losing the remainder", () => {
  assert.deepEqual(splitName("  Aadhya  Serene Customer  "), {
    firstName: "Aadhya",
    lastName: "Serene Customer",
  });
});

test("consolidates repeated submissions and retains embedded history", () => {
  const plan = buildMigrationPlan(
    [
      {
        _id: { $oid: "n1" },
        name: "First Name",
        phone: "+91 98765 43210",
        email: "first@example.com",
        leadStatus: "active",
        salesLeadStatus: "cold",
        updatedAt: { $date: "2026-10-01T00:00:00.000Z" },
        callLogs: [{ _id: { $oid: "c1" }, callStatus: "answered" }],
      },
      {
        _id: { $oid: "n2" },
        name: "Latest Customer",
        phone: "9876543210",
        email: "latest@example.com",
        leadStatus: "dead",
        salesLeadStatus: "dead",
        updatedAt: { $date: "2026-10-02T00:00:00.000Z" },
        callLogs: [
          { _id: { $oid: "c1" }, callStatus: "answered" },
          { _id: { $oid: "c2" }, callStatus: "not_answered" },
        ],
        salesRemarks: [{ _id: { $oid: "r1" }, text: "Followed up" }],
      },
      { _id: { $oid: "bad" }, name: "Bad", phone: "unknown", email: "" },
    ],
    [
      {
        _id: { $oid: "w1" },
        enquiryRecordId: "n1",
        history: [{ messageId: "m1", message: "Hello" }],
      },
    ],
  );

  assert.deepEqual(plan.stats, {
    notifications: 3,
    validNotifications: 2,
    canonicalLeads: 1,
    repeatedSubmissions: 1,
    quarantined: 1,
    calls: 2,
    remarks: 1,
    lifecycleEvents: 0,
    metadataActivities: 0,
    conversations: 1,
    messages: 1,
  });
  assert.equal(plan.groups[0].firstName, "Latest");
  assert.equal(plan.groups[0].lastName, "Customer");
  assert.equal(plan.groups[0].email, "latest@example.com");
  assert.equal(plan.groups[0].status, "closed");
  assert.equal(plan.groups[0].temperature, null);
});
