"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export function createSupabaseBrowserClient() {
  const { publishableKey, url } = getSupabasePublicConfig();
  return createBrowserClient(url, publishableKey);
}
