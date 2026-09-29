import { NextRequest, NextResponse } from "next/server";
import {
  consumeMarketingRateLimit,
  getPublicMarketingForm,
  isAllowedMarketingOrigin,
  marketingSubjectHash,
  type PublicMarketingForm,
  verifyMarketingSecret,
} from "@/lib/marketing";

export function marketingCorsHeaders(origin: string | null) {
  const headers = new Headers({ Vary: "Origin" });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Sthyra-Form-Secret",
  );
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

export function marketingJson(
  body: unknown,
  status: number,
  origin: string | null = null,
) {
  return NextResponse.json(body, {
    status,
    headers: marketingCorsHeaders(origin),
  });
}

function clientAddress(request: NextRequest) {
  return (
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function authorizePublicMarketingRequest(args: {
  request: NextRequest;
  publicKey: string;
  action: "track" | "submit";
}) {
  const { request, publicKey, action } = args;
  const origin = request.headers.get("origin");
  const form = await getPublicMarketingForm(publicKey);
  if (!form) {
    return {
      ok: false as const,
      response: marketingJson({ error: "Form not found" }, 404, origin),
    };
  }
  const originAllowed = isAllowedMarketingOrigin(form, origin);
  const secretAllowed = verifyMarketingSecret(
    request.headers.get("x-sthyra-form-secret"),
    form.submission_secret_hash,
  );
  if (!originAllowed && !secretAllowed) {
    return {
      ok: false as const,
      response: marketingJson({ error: "Origin is not allowed" }, 403),
    };
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > 64 * 1024) {
    return {
      ok: false as const,
      response: marketingJson({ error: "Request is too large" }, 413, origin),
    };
  }
  const subjectHash = marketingSubjectHash(
    `${clientAddress(request)}:${request.headers.get("user-agent") ?? ""}`,
  );
  const accepted = await consumeMarketingRateLimit({
    formId: form.form_id,
    subjectHash,
    action,
    limit: action === "track" ? 240 : 30,
  });
  if (!accepted) {
    return {
      ok: false as const,
      response: marketingJson(
        { error: "Too many requests" },
        429,
        originAllowed ? origin : null,
      ),
    };
  }
  return {
    ok: true as const,
    form: form as PublicMarketingForm,
    origin: originAllowed ? origin : null,
  };
}

export async function publicMarketingOptions(
  request: NextRequest,
  publicKey: string,
) {
  const origin = request.headers.get("origin");
  const form = await getPublicMarketingForm(publicKey);
  if (!form || !isAllowedMarketingOrigin(form, origin)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, {
    status: 204,
    headers: marketingCorsHeaders(origin),
  });
}

