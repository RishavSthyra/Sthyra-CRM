import { NextRequest, NextResponse } from "next/server";
import { adminPool } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { linkExistingCrmIdentity } from "@/lib/supabase/workspaceProvisioning";
import { enforceRateLimits } from "@/lib/rateLimit";

export async function POST(request: NextRequest) {
  const ipLimit = await enforceRateLimits(request, [
    { action: "otp-verify:ip", limit: 20, windowSeconds: 15 * 60 },
  ]);
  if (ipLimit) return ipLimit;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }

  const source =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const email =
    typeof source.email === "string" ? source.email.trim().toLowerCase() : "";
  const token = typeof source.token === "string" ? source.token.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6,10}$/.test(token)) {
    return NextResponse.json(
      { error: "Enter the email address and complete verification code" },
      { status: 422 },
    );
  }

  const accountLimit = await enforceRateLimits(request, [
    {
      action: "otp-verify:email",
      subject: `email:${email}`,
      limit: 10,
      windowSeconds: 15 * 60,
    },
  ]);
  if (accountLimit) return accountLimit;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    if (error || !data.user) {
      return NextResponse.json(
        { error: "That verification code is incorrect or has expired" },
        { status: 400 },
      );
    }

    const user = await linkExistingCrmIdentity(
      data.user.id,
      data.user.email ?? email,
    );
    if (!user) {
      await supabase.auth.signOut();
      return NextResponse.json(
        { error: "This account is not connected to a CRM workspace" },
        { status: 403 },
      );
    }
    await adminPool.query(
      "UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE user_id=$1",
      [user.user_id],
    );
    const workspace = await adminPool.query<{ workspace_domain: string | null }>(
      `SELECT company.workspace_domain
       FROM users app_user
       JOIN teams team ON team.team_id = app_user.team_id
       JOIN companies company ON company.company_id = team.company_id
       WHERE app_user.user_id = $1`,
      [user.user_id],
    );

    const response = NextResponse.json({
      message: "Email verified successfully",
      user,
      workspace_domain: workspace.rows[0]?.workspace_domain ?? null,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Failed to verify signup email", error);
    return NextResponse.json(
      { error: "Unable to verify the email address" },
      { status: 500 },
    );
  }
}
