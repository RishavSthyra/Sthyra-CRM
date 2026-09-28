import type { Metadata } from "next";
import { Suspense } from "react";
import { InvitationOnboarding } from "@/components/auth/InvitationOnboarding";

export const metadata: Metadata = {
  title: "Accept workspace invitation | Sthyra CRM",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

async function InvitationContent({ params }: InvitePageProps) {
  const { token } = await params;
  return <InvitationOnboarding token={token} />;
}

export default function InvitePage({
  params,
}: InvitePageProps) {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-black" />}>
      <InvitationContent params={params} />
    </Suspense>
  );
}
