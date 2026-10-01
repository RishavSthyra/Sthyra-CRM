import { LoaderCircle } from "lucide-react";

export default function QuotationLoading() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f7f6] text-[#55605b]">
      <span className="flex items-center gap-2 text-sm">
        <LoaderCircle className="size-4 animate-spin" /> Loading quotation…
      </span>
    </main>
  );
}
