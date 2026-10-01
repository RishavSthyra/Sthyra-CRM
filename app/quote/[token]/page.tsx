import { PublicQuotation } from "@/components/opportunities/PublicQuotation";

export default async function QuotationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicQuotation token={token} />;
}
