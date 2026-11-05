import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getManualContactIdentityKey,
  validateManualLeadCreationPayload,
} from "../lib/manualLeadCreation";
import { isLeadStageAvailableForManualCreation } from "../lib/manualLeadStagePolicy";

const sourceId = "00000000-0000-4000-8000-000000000101";

function validPayload() {
  return {
    project_id: 12,
    stage_key: "contact_attempted",
    contact: {
      first_name: "Aarav",
      last_name: "Sharma",
      phone_number: "+91 98765 43210",
      email: "AARAV@example.com",
    },
    lead: {
      source_id: sourceId,
      sub_source: "Project landing page",
      temperature: "warm",
      budget: 15_000_000,
      preferred_location: "Whitefield",
      preferred_config: "3 BHK",
      buying_reason: "Primary residence",
    },
  };
}

test("manual lead creation normalizes contact and workflow data", () => {
  const result = validateManualLeadCreationPayload(validPayload());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.project_id, 12);
  assert.equal(result.data.stage_key, "contact_attempted");
  assert.equal(result.data.contact.email, "aarav@example.com");
  assert.equal(result.data.lead.source_id, sourceId);
  assert.equal(result.data.lead.budget, 15_000_000);
  assert.equal("contact_id" in result.data.lead, false);
  assert.equal("project_id" in result.data.lead, false);
});

test("manual lead creation requires identity, project and a valid stage key", () => {
  const missingIdentity = validateManualLeadCreationPayload({
    ...validPayload(),
    contact: { first_name: "Aarav", phone_number: null, email: null },
  });
  assert.equal(missingIdentity.ok, false);
  if (!missingIdentity.ok) {
    assert.ok(missingIdentity.errors.some((error) => /phone_number or contact\.email/.test(error)));
  }

  const invalidWorkflow = validateManualLeadCreationPayload({
    ...validPayload(),
    project_id: 0,
    stage_key: "Invalid Stage!",
  });
  assert.equal(invalidWorkflow.ok, false);
  if (!invalidWorkflow.ok) {
    assert.ok(invalidWorkflow.errors.includes("project_id must be a positive integer"));
    assert.ok(invalidWorkflow.errors.includes("stage_key must be a valid stage key"));
  }
});

test("manual lead creation rejects privilege-bearing and unknown fields", () => {
  const payload = validPayload();
  const result = validateManualLeadCreationPayload({
    ...payload,
    company_id: 99,
    lead: {
      ...payload.lead,
      project_id: 999,
      contact_id: "00000000-0000-4000-8000-000000000222",
      status: "qualified",
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.includes("Unknown field: company_id"));
    assert.ok(result.errors.includes("contact_id and project_id must be provided at the top level"));
    assert.ok(result.errors.some((error) => error.includes("Unknown field: status")));
  }
});

test("manual stage policy keeps command-managed and terminal stages out", () => {
  assert.equal(
    isLeadStageAvailableForManualCreation({ stage_key: "new", is_terminal: false }),
    true,
  );
  assert.equal(
    isLeadStageAvailableForManualCreation({ stage_key: "contacted", is_terminal: false }),
    true,
  );
  assert.equal(
    isLeadStageAvailableForManualCreation({ stage_key: "qualified", is_terminal: false }),
    false,
  );
  assert.equal(
    isLeadStageAvailableForManualCreation({ stage_key: "nurturing", is_terminal: false }),
    false,
  );
  assert.equal(
    isLeadStageAvailableForManualCreation({ stage_key: "closed_won", is_terminal: true }),
    false,
  );
});

test("contact identity lock keys normalize case and phone punctuation", () => {
  assert.equal(
    getManualContactIdentityKey(7, {
      email: " Aarav@Example.com ",
      phone_number: "+91 98765-43210",
    }),
    getManualContactIdentityKey(7, {
      email: "aarav@example.com",
      phone_number: "919876543210",
    }),
  );
  assert.notEqual(
    getManualContactIdentityKey(7, { email: "aarav@example.com" }),
    getManualContactIdentityKey(8, { email: "aarav@example.com" }),
  );
});

test("manual lead endpoint is transactional, permissioned and routing-aware", () => {
  const route = readFileSync("app/api/leads/manual/route.ts", "utf8");
  const leads = readFileSync("lib/leads.ts", "utf8");
  assert.match(route, /requireLeadVisibility\(request, "LEADS_CREATE"\)/);
  assert.match(route, /canAccessProject/);
  assert.match(route, /client\.query\("BEGIN"\)/);
  assert.match(route, /resolveOrCreateManualContact/);
  assert.match(route, /initialStageKey: validation\.data\.stage_key/);
  assert.match(route, /status NOT IN \('invalid', 'dead', 'duplicate', 'closed'\)/);
  assert.match(route, /client\.query\("COMMIT"\)/);
  assert.match(route, /client\.query\("ROLLBACK"\)/);
  assert.match(leads, /startSlaInstancesForLead/);
  assert.match(leads, /applyRoutingForLead/);
  assert.match(leads, /queueWhatsAppAutomationEvent/);
});

test("leads page exposes a permission-aware floating action and stage dropdown", () => {
  const page = readFileSync("app/leads/page.tsx", "utf8");
  const dialog = readFileSync("components/leads/CreateLeadDialog.tsx", "utf8");
  assert.match(page, /permissions\?\.includes\("LEADS_CREATE"\)/);
  assert.match(page, /fixed right-8 bottom-6/);
  assert.match(page, /<CreateLeadDialog/);
  assert.match(dialog, /Select a project and stage/);
  assert.match(dialog, /api\/projects\/\$\{projectId\}\/lead-stages/);
  assert.match(dialog, /api\/leads\/manual/);
});

test("50,000 mixed payloads retain validation boundaries under load", () => {
  let accepted = 0;
  let rejected = 0;
  for (let index = 0; index < 50_000; index += 1) {
    const payload = validPayload();
    payload.contact.email = `lead.${index}@example.com`;
    if (index % 5 === 0) payload.stage_key = "not a stage";
    if (index % 7 === 0) payload.contact.phone_number = "bad";
    const result = validateManualLeadCreationPayload(payload);
    if (result.ok) accepted += 1;
    else rejected += 1;
  }
  assert.equal(accepted + rejected, 50_000);
  assert.ok(accepted > 0);
  assert.ok(rejected > 0);
});
