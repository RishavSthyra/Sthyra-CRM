import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeWebsiteSubmission,
  type PublicMarketingForm,
} from "../lib/marketing";

const form: PublicMarketingForm = {
  form_id: "00000000-0000-4000-8000-000000000001",
  company_id: 1,
  project_id: 1,
  integration_id: null,
  source_id: null,
  campaign_id: null,
  form_name: "Website leads",
  provider: "website",
  public_key: "00000000-0000-4000-8000-000000000002",
  provider_form_id: null,
  submission_secret_hash: null,
  webhook_secret_hash: null,
  allowed_origins: [],
  field_mapping: {},
  lead_defaults: {},
  consent_notice: null,
  is_active: true,
};

test("website lead normalization retains geographic drill-down fields", () => {
  const normalized = normalizeWebsiteSubmission(form, {
    event_id: "lead-map-1",
    fields: {
      full_name: "Map Test",
      email: "map@example.com",
      country: "India",
      state: "Karnataka",
      district: "Bengaluru Urban",
      city: "Bengaluru",
      latitude: "12.9716",
      longitude: "77.5946",
    },
  });

  assert.deepEqual(normalized.lead?.qualification_data, {
    geo_country: "India",
    geo_state: "Karnataka",
    geo_district: "Bengaluru Urban",
    geo_city: "Bengaluru",
    geo_latitude: "12.9716",
    geo_longitude: "77.5946",
  });
});
