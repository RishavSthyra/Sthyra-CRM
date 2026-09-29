import { NextRequest, NextResponse } from "next/server";
import { adminPool } from "@/lib/db";
import {
  AuthEmailConfigurationError,
  sendSignupVerificationCode,
} from "@/lib/authVerificationEmail";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const GENERIC_MESSAGE =
  "If the account is awaiting verification, a new code has been sent.";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const email =
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    typeof (body as Record<string, unknown>).email === "string"
      ? String((body as Record<string, unknown>).email)
          .trim()
          .toLowerCase()
      : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Enter a valid email address" },
      { status: 422 },
    );
  }

  try {
    const identity = await adminPool.query(
      `SELECT u.auth_user_id
       FROM users u
       WHERE LOWER(u.email) = LOWER($1)
         AND u.auth_user_id IS NOT NULL
         AND u.deleted_at IS NULL
       LIMIT 1`,
      [email],
    );
    const authUserId = identity.rows[0]?.auth_user_id;
    if (!authUserId) {
      return NextResponse.json({ message: GENERIC_MESSAGE });
    }

    const admin = createSupabaseAdminClient();
    const existing = await admin.auth.admin.getUserById(authUserId);
    if (existing.error || existing.data.user.email_confirmed_at) {
      return NextResponse.json({ message: GENERIC_MESSAGE });
    }

    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (error?.status === 429) {
      return NextResponse.json(
        { error: "Please wait before requesting another code" },
        { status: 429 },
      );
    }
    if (error || !data.properties?.email_otp) {
      console.error("Failed to resend signup verification", error);
      return NextResponse.json(
        { error: "Unable to send another verification code" },
        { status: 500 },
      );
    }
    await sendSignupVerificationCode({
      email,
      code: data.properties.email_otp,
    });
    return NextResponse.json({
      message: GENERIC_MESSAGE,
      otp_length: data.properties.email_otp.length,
    });
  } catch (error) {
    console.error("Unable to resend signup verification", error);
    if (error instanceof AuthEmailConfigurationError) {
      return NextResponse.json(
        { error: "Signup email is not configured on the server" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "Unable to send another verification code" },
      { status: 500 },
    );
  }
}
