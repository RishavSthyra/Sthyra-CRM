import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import {
  createTenantAuthContext,
  TENANT_AUTH_HEADER,
} from "@/lib/tenantRequestContext";
import { workspaceSlugFromHostname } from "@/lib/tenantHost";

const LEGACY_AUTH_COOKIE =
  /^(?:sb-[a-z0-9]+-auth-token(?:\.\d+)?|sthyra_(?:access|refresh)_token)$/i;

function clearLegacySharedAuthCookies(
  request: NextRequest,
  response: NextResponse,
) {
  const legacyDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  if (!legacyDomain) return;

  const names = new Set(
    request.cookies
      .getAll()
      .map((cookie) => cookie.name)
      .filter((name) => LEGACY_AUTH_COOKIE.test(name)),
  );
  for (const name of names) {
    for (const path of ["/", "/api/auth"]) {
      response.cookies.set(name, "", {
        domain: legacyDomain,
        expires: new Date(0),
        httpOnly: true,
        maxAge: 0,
        path,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
  }
}

export async function updateSupabaseSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(TENANT_AUTH_HEADER);

  if (!isSupabaseAuthConfigured()) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          for (const cookie of cookiesToSet) {
            request.cookies.set(cookie.name, cookie.value);
          }
          response = NextResponse.next({
            request: { headers: requestHeaders },
          });
          for (const cookie of cookiesToSet) {
            response.cookies.set(cookie.name, cookie.value, {
              ...cookie.options,
            });
          }
        },
      },
    },
  );

  const { data, error } = await supabase.auth.getClaims();
  const subject = !error && data?.claims?.sub;
  if (typeof subject === "string") {
    const workspaceSlug = workspaceSlugFromHostname(request.nextUrl.hostname);
    requestHeaders.set(
      TENANT_AUTH_HEADER,
      createTenantAuthContext(subject, workspaceSlug),
    );
    const authenticatedResponse = NextResponse.next({
      request: { headers: requestHeaders },
    });
    for (const cookie of response.cookies.getAll()) {
      authenticatedResponse.cookies.set(cookie);
    }
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(header);
      if (value) authenticatedResponse.headers.set(header, value);
    }
    response = authenticatedResponse;
  }

  clearLegacySharedAuthCookies(request, response);

  return response;
}
