import { NextRequest, NextResponse } from "next/server";
import {
  EmailProvider,
  createPkcePair,
  getAuthorizationUrl,
  providerRedirectUri,
} from "@/lib/email/oauthProviders";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { createSignedState } from "@/lib/oauthState";

export const runtime = "nodejs";

const STATE_COOKIE = "sthyra_mailbox_oauth_state";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const { provider: providerValue } = await params;
  if (providerValue !== "google" && providerValue !== "microsoft") {
    return NextResponse.json({ error: "Unsupported email provider" }, { status: 404 });
  }
  const provider = providerValue as EmailProvider;
  try {
    const pkce = createPkcePair();
    const state = createSignedState({
      purpose: "mailbox-oauth" as const,
      provider,
      userId: scope.context.userId,
      companyId: scope.context.access.company.company_id,
      codeVerifier: pkce.verifier,
    });
    const response = NextResponse.redirect(
      getAuthorizationUrl({
        provider,
        purpose: "mailbox",
        redirectUri: providerRedirectUri(request, provider, "mailbox"),
        state,
        codeChallenge: pkce.challenge,
      }),
    );
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: `/api/email-connections/${provider}/callback`,
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    console.error(`Unable to start ${provider} mailbox OAuth`, error);
    return NextResponse.json(
      { error: `${provider === "google" ? "Google" : "Microsoft"} mailbox connection is not configured` },
      { status: 503 },
    );
  }
}
