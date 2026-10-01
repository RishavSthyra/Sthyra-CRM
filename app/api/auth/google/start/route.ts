import { connection, NextRequest, NextResponse } from "next/server";
import { createPkcePair, getAuthorizationUrl, providerRedirectUri } from "@/lib/email/oauthProviders";
import { createSignedState } from "@/lib/oauthState";
import { getAppUrl } from "@/lib/appUrl";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STATE_COOKIE = "sthyra_google_auth_state";

export async function GET(request: NextRequest) {
  await connection();
  try {
    if (isSupabaseAuthConfigured()) {
      const supabase = await createSupabaseServerClient();
      const { error: signOutError } = await supabase.auth.signOut({
        scope: "local",
      });
      if (signOutError) throw signOutError;
      const redirectTo = new URL(
        "/api/auth/google/callback",
        getAppUrl(request),
      ).toString();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error || !data.url) throw error ?? new Error("Missing OAuth URL");
      return NextResponse.redirect(data.url);
    }

    const mode = request.nextUrl.searchParams.get("mode") === "signup" ? "signup" : "login";
    const pkce = createPkcePair();
    const state = createSignedState({ purpose: "google-auth" as const, mode, codeVerifier: pkce.verifier });
    const response = NextResponse.redirect(
      getAuthorizationUrl({
        provider: "google",
        purpose: "auth",
        redirectUri: providerRedirectUri(request, "google", "auth"),
        state,
        codeChallenge: pkce.challenge,
      }),
    );
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth/google/callback",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    console.error("Unable to start Google authentication", error);
    return NextResponse.json(
      { error: "Google authentication is not configured" },
      { status: 503 },
    );
  }
}
