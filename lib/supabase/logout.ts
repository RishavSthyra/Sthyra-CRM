type NamedCookie = { name: string };

export function getSupabaseAuthStorageKey(supabaseUrl: string): string {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  if (!projectRef) throw new Error("Supabase URL does not contain a project ref");
  return `sb-${projectRef}-auth-token`;
}

export function getSupabaseAuthCookieNames(
  cookies: readonly NamedCookie[],
  supabaseUrl: string,
): string[] {
  const storageKey = getSupabaseAuthStorageKey(supabaseUrl);
  return cookies
    .map((cookie) => cookie.name)
    .filter(
      (name) =>
        name === storageKey ||
        name.startsWith(`${storageKey}.`) ||
        name.startsWith(`${storageKey}-`),
    );
}
