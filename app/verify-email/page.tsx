import type { Metadata } from "next";
import { Suspense } from "react";
import { EmailVerification } from "@/components/auth/EmailVerification";

export const metadata: Metadata = {
  title: "Verify your email | Sthyra CRM",
  robots: { index: false, follow: false },
};

type VerifyEmailPageProps = {
  searchParams: Promise<{
    email?: string | string[];
    length?: string | string[];
    next?: string | string[];
  }>;
};

async function VerificationContent({ searchParams }: VerifyEmailPageProps) {
  const params = await searchParams;
  const value = params.email;
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  const requestedLength =
    typeof params.length === "string" ? Number(params.length) : Number.NaN;
  const otpLength =
    Number.isInteger(requestedLength) &&
    requestedLength >= 6 &&
    requestedLength <= 10
      ? requestedLength
      : 8;
  const next = params.next === "login" ? "login" : "dashboard";
  return (
    <EmailVerification
      email={email}
      initialOtpLength={otpLength}
      next={next}
    />
  );
}

export default function VerifyEmailPage({
  searchParams,
}: VerifyEmailPageProps) {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-black" />}>
      <VerificationContent searchParams={searchParams} />
    </Suspense>
  );
}
