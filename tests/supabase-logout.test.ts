import assert from "node:assert/strict";
import test from "node:test";
import {
  getSupabaseAuthCookieNames,
  getSupabaseAuthStorageKey,
} from "../lib/supabase/logout";

const supabaseUrl = "https://hteastyckrvfzovwhzje.supabase.co";

test("derives the Supabase auth cookie storage key", () => {
  assert.equal(
    getSupabaseAuthStorageKey(supabaseUrl),
    "sb-hteastyckrvfzovwhzje-auth-token",
  );
});

test("local logout clears session chunks and related auth storage only", () => {
  const names = getSupabaseAuthCookieNames(
    [
      { name: "sb-hteastyckrvfzovwhzje-auth-token.0" },
      { name: "sb-hteastyckrvfzovwhzje-auth-token.1" },
      { name: "sb-hteastyckrvfzovwhzje-auth-token-code-verifier" },
      { name: "analytics_session" },
      { name: "sb-another-project-auth-token" },
    ],
    supabaseUrl,
  );

  assert.deepEqual(names, [
    "sb-hteastyckrvfzovwhzje-auth-token.0",
    "sb-hteastyckrvfzovwhzje-auth-token.1",
    "sb-hteastyckrvfzovwhzje-auth-token-code-verifier",
  ]);
});
