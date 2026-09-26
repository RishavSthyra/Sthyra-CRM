import type { NextRequest } from "next/server";

export function getAppUrl(request?: NextRequest): string {
  const configured = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (request) return request.nextUrl.origin;
  return "http://localhost:3000";
}
