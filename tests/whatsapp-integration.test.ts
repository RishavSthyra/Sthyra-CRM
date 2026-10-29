import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isWithinWhatsAppServiceWindow,
  normalizeWhatsAppPhone,
  renderAutomationParameters,
  validateTemplateName,
  verifyMetaWebhookSignature,
} from "../lib/whatsapp";

test("WhatsApp phone numbers normalize to Meta's international digit format", () => {
  assert.equal(normalizeWhatsAppPhone("+91 98765 43210"), "919876543210");
  assert.equal(normalizeWhatsAppPhone("123"), null);
  assert.equal(normalizeWhatsAppPhone("not a phone"), null);
});
test("free-form WhatsApp replies close exactly 24 hours after the last inbound message", () => {
  const now = new Date("2026-10-29T12:00:00.000Z");
  assert.equal(isWithinWhatsAppServiceWindow("2026-10-28T12:00:00.001Z", now), true);
  assert.equal(isWithinWhatsAppServiceWindow("2026-10-28T12:00:00.000Z", now), false);
  assert.equal(isWithinWhatsAppServiceWindow(null, now), false);
});

test("Meta webhook verification rejects tampered payloads", () => {
  const secret = "meta-test-secret";
  const body = JSON.stringify({ object: "whatsapp_business_account" });
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(verifyMetaWebhookSignature(body, signature, secret), true);
  assert.equal(verifyMetaWebhookSignature(`${body}x`, signature, secret), false);
  assert.equal(verifyMetaWebhookSignature(body, null, secret), false);
});

test("Meta template names and automation placeholders are deterministic", () => {
  assert.equal(validateTemplateName(" Site_Visit_Confirmed "), "site_visit_confirmed");
  assert.equal(validateTemplateName("spaces are invalid"), null);
  assert.deepEqual(
    renderAutomationParameters(
      ["Hi {{first_name}}", "Your project is {{ project_name }}"],
      { first_name: "Priya", project_name: "Aadhya Serene" },
    ),
    ["Hi Priya", "Your project is Aadhya Serene"],
  );
});

test("WhatsApp migration enforces approved automation and auditable delivery jobs", () => {
  const migration = readFileSync(
    new URL("../database/migrations/20261027_create_whatsapp_cloud_platform.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS whatsapp_connections/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS whatsapp_templates/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS whatsapp_messages/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS whatsapp_automation_rules/);
  assert.match(migration, /template\.status='APPROVED'/);
  assert.match(migration, /source_type IN \('task', 'note', 'appointment', 'call', 'email', 'whatsapp'\)/);
});

test("Activity exposes WhatsApp inbox, templates, automations and setup", () => {
  const page = readFileSync(new URL("../app/activity/page.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../components/activity/WhatsAppView.tsx", import.meta.url), "utf8");
  assert.match(page, /id: "whatsapp", label: "WhatsApp"/);
  assert.match(workspace, /"inbox", "templates", "automations", "setup"/);
  assert.match(workspace, /Connect with Meta/);
  assert.match(workspace, /24-hour/);
});

test("important CRM milestones enqueue WhatsApp automations", () => {
  const lead = readFileSync(new URL("../lib/leads.ts", import.meta.url), "utf8");
  const qualification = readFileSync(new URL("../app/api/leads/[leadid]/qualify/route.ts", import.meta.url), "utf8");
  const quotationSend = readFileSync(new URL("../app/api/opportunities/[opportunityid]/quotations/[quotationid]/send/route.ts", import.meta.url), "utf8");
  const quotationReply = readFileSync(new URL("../app/api/public/quotations/[token]/route.ts", import.meta.url), "utf8");
  const booking = readFileSync(new URL("../app/api/opportunities/[opportunityid]/quotations/[quotationid]/convert/route.ts", import.meta.url), "utf8");
  assert.match(lead, /eventName: "lead_created"/);
  assert.match(qualification, /eventName: "lead_qualified"/);
  assert.match(quotationSend, /eventName: "quotation_sent"/);
  assert.match(quotationReply, /eventName: "quotation_accepted"/);
  assert.match(booking, /eventName: "booking_confirmed"/);
});
