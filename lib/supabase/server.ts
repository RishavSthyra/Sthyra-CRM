import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export async function createSupabaseServerClient() {
  // Authentication is request-specific and must never be evaluated while
  // Next.js is building a static shell for a route handler.
  await connection();
  const cookieStore = await cookies();
  const { publishableKey, url } = getSupabasePublicConfig();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          const sharedDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();
          for (const cookie of cookiesToSet) {
            cookieStore.set(cookie.name, cookie.value, {
              ...cookie.options,
              ...(sharedDomain ? { domain: sharedDomain } : {}),
            });
          }
        } catch {
          // Server Components cannot write cookies. The root Proxy refreshes
          // the session and persists refreshed cookies for those requests.
        }
      },
    },
  });
}
