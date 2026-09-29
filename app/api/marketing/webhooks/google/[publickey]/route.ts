import { NextRequest, NextResponse } from "next/server";
import {
  consumeMarketingRateLimit,
  getPublicMarketingForm,
  marketingSubjectHash,
  normalizeGoogleLeadSubmission,
  processMarketingSubmission,
  verifyMarketingSecret,
} from "@/lib/marketing";
import { isObject } from "@/utils/isObject";

type Context = { params: Promise<{ publickey: string }> };

export async function POST(request: NextRequest, context: Context) {
  const form = await getPublicMarketingForm((await context.params).publickey);
  if (!form || form.provider !== "google_lead_form") {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > 128 * 1024) {
    return NextResponse.json({ error: "Request is too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    !isObject(body) ||
    Array.isArray(body) ||
    !verifyMarketingSecret(
      typeof body.google_key === "string" ? body.google_key : null,
      form.webhook_secret_hash,
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const leadId = typeof body.lead_id === "string" ? body.lead_id : "unknown";
  const allowed = await consumeMarketingRateLimit({
    formId: form.form_id,
    subjectHash: marketingSubjectHash(`google:${leadId}`),
    action: "webhook",
    limit: 10,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (
    form.provider_form_id &&
    String(body.form_id ?? "") !== form.provider_form_id
  ) {
    return NextResponse.json({ error: "Unknown Google form" }, { status: 422 });
  }
  try {
    const result = await processMarketingSubmission(
      form,
      normalizeGoogleLeadSubmission(form, body),
    );
    return NextResponse.json(result, {
      status: result.status === "processed" ? 200 : 202,
    });
  } catch (error) {
    console.error("Unable to process Google lead form webhook", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid webhook" },
      { status: 422 },
    );
  }
}

