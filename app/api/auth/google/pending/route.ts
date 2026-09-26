import { NextRequest, NextResponse } from "next/server";
import { readSignedState } from "@/lib/oauthState";

type PendingGoogleSignup = {
  purpose: "google-signup";
  subject: string;
  email: string;
  name: string | null;
};

export async function GET(request: NextRequest) {
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
