import { NextRequest } from "next/server";
import {
  normalizeWebsiteSubmission,
  processMarketingSubmission,
} from "@/lib/marketing";
import {
  authorizePublicMarketingRequest,
  marketingJson,
  publicMarketingOptions,
} from "@/lib/marketingHttp";

type Context = { params: Promise<{ publickey: string }> };

export async function OPTIONS(request: NextRequest, context: Context) {
  return publicMarketingOptions(request, (await context.params).publickey);
}

export async function POST(request: NextRequest, context: Context) {
  const access = await authorizePublicMarketingRequest({
    request,
    publicKey: (await context.params).publickey,
    action: "submit",
  });
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return marketingJson({ error: "Invalid JSON" }, 400, access.origin);
  }
  try {
    const normalized = normalizeWebsiteSubmission(access.form, body);
    const result = await processMarketingSubmission(access.form, normalized);
    return marketingJson(
      result,
      result.status === "processed" ? (result.duplicate ? 200 : 201) : 202,
      access.origin,
    );
  } catch (error) {
    console.error("Unable to process website lead submission", error);
    return marketingJson(
      { error: error instanceof Error ? error.message : "Invalid submission" },
      422,
      access.origin,
    );
  }
}

