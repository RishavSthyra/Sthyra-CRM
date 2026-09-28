import { NextRequest, NextResponse } from "next/server";
import { adminPool } from "@/lib/db";
import { getAppUrl } from "@/lib/appUrl";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeDestination(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//")
    ? value
    : "/dashboard";
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeDestination(request.nextUrl.searchParams.get("next"));
  if (!code) {
    return NextResponse.redirect(
      new URL("/login?auth_error=missing_code", getAppUrl(request)),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL("/login?auth_error=invalid_link", getAppUrl(request)),
    );
  }
  const { data } = await supabase.auth.getUser();
  if (data.user?.email) {
    try {
      await adminPool.query(
        `UPDATE users
         SET email=$1, updated_at=CURRENT_TIMESTAMP
         WHERE auth_user_id=$2
           AND LOWER(email)<>LOWER($1)`,
        [data.user.email, data.user.id],
      );
    } catch (error) {
      console.error("Failed to synchronize confirmed auth email", error);
      return NextResponse.redirect(
        new URL("/settings?auth_error=email_sync", getAppUrl(request)),
      );
    }
  }
  return NextResponse.redirect(new URL(next, getAppUrl(request)));
}
