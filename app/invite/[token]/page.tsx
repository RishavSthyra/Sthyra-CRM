import type { Metadata } from "next";
import { InvitationOnboarding } from "@/components/auth/InvitationOnboarding";

export const metadata: Metadata = {
  title: "Accept workspace invitation | Sthyra CRM",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <InvitationOnboarding token={token} />;
}
