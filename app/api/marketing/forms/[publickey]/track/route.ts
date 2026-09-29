import { NextRequest } from "next/server";
import { recordMarketingTouchpoint } from "@/lib/marketing";
import {
  authorizePublicMarketingRequest,
  marketingJson,
  publicMarketingOptions,
} from "@/lib/marketingHttp";
import { isObject } from "@/utils/isObject";

type Context = { params: Promise<{ publickey: string }> };

export async function OPTIONS(request: NextRequest, context: Context) {
  return publicMarketingOptions(request, (await context.params).publickey);
}

export async function POST(request: NextRequest, context: Context) {
  const access = await authorizePublicMarketingRequest({
    request,
    publicKey: (await context.params).publickey,
    action: "track",
  });
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return marketingJson({ error: "Invalid JSON" }, 400, access.origin);
  }
  if (!isObject(body) || Array.isArray(body)) {
    return marketingJson(
      { error: "Request body must be an object" },
      422,
      access.origin,
    );
  }
  try {
    const result = await recordMarketingTouchpoint({
      form: access.form,
      idempotencyKey: String(body.event_id ?? body.idempotency_key ?? ""),
      eventType: String(body.event_type ?? "page_view"),
      attribution: body.attribution,
      metadata:
        isObject(body.metadata) && !Array.isArray(body.metadata)
          ? body.metadata
          : {},
    });
    return marketingJson(
      {
        accepted: true,
        duplicate: !result.created,
        touchpoint_id: result.touchpoint.touchpoint_id,
      },
      result.created ? 201 : 200,
      access.origin,
    );
  } catch (error) {
    console.error("Unable to record marketing touchpoint", error);
    return marketingJson(
      { error: error instanceof Error ? error.message : "Invalid touchpoint" },
      422,
      access.origin,
    );
  }
}

