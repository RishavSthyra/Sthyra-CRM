import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import {
  createTenantAuthContext,
  TENANT_AUTH_HEADER,
} from "@/lib/tenantRequestContext";

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
            response.cookies.set(cookie.name, cookie.value, cookie.options);
          }
        },
      },
    },
  );

  const { data, error } = await supabase.auth.getClaims();
  const subject = !error && data?.claims?.sub;
  if (typeof subject === "string") {
    requestHeaders.set(TENANT_AUTH_HEADER, createTenantAuthContext(subject));
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

  return response;
}
