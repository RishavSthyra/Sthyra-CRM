import { Suspense } from "react";
import { PublicBookingForm } from "@/components/opportunities/PublicBookingForm";

async function BookingFormContent({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicBookingForm token={token} />;
}

export default function BookingFormPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-screen place-items-center bg-[#f4f7f5] text-sm text-[#68716d]">
          Loading booking form…
        </main>
      }
    >
      <BookingFormContent params={params} />
    </Suspense>
  );
}
