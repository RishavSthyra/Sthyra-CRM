import { NextRequest, NextResponse } from "next/server";
import { readSignedState } from "@/lib/oauthState";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PendingGoogleSignup = {
  purpose: "google-signup";
  subject: string;
  email: string;
  name: string | null;
};

export async function GET(request: NextRequest) {
  if (isSupabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    const user = !error ? data.user : null;
    if (!user?.email) return NextResponse.json({ pending: null });

    const fullName =
      typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : typeof user.user_metadata?.name === "string"
          ? user.user_metadata.name
          : "";
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    return NextResponse.json({
      pending: {
        email: user.email,
        first_name:
          typeof user.user_metadata?.given_name === "string"
            ? user.user_metadata.given_name
            : parts[0] || "",
        last_name:
          typeof user.user_metadata?.family_name === "string"
            ? user.user_metadata.family_name
            : parts.slice(1).join(" "),
      },
    });
  }

  const pending = readSignedState<PendingGoogleSignup>(
    request.cookies.get("sthyra_google_signup_pending")?.value,
  );
  if (!pending || pending.purpose !== "google-signup") {
    return NextResponse.json({ pending: null });
  }
  const parts = (pending.name || "").trim().split(/\s+/).filter(Boolean);
  return NextResponse.json({
    pending: {
      email: pending.email,
      first_name: parts[0] || "",
      last_name: parts.slice(1).join(" "),
    },
  });
}
