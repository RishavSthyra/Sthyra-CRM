import type { NextRequest } from "next/server";
import { isTenantApplicationHostname } from "@/lib/tenantHost";

export function getAppUrl(request?: NextRequest): string {
  if (
    request &&
    (isTenantApplicationHostname(request.nextUrl.hostname) ||
      request.nextUrl.hostname === "localhost" ||
      request.nextUrl.hostname === "127.0.0.1")
  ) {
    return request.nextUrl.origin;
  }
  const configured = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (request) return request.nextUrl.origin;
  return "http://localhost:3000";
}
