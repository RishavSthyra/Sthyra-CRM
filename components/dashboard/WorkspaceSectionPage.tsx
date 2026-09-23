"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";

export function WorkspaceSectionPage({
  description,
  eyebrow = "Workspace",
  title,
}: {
  description: string;
  eyebrow?: string;
  title: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchWithSession("/api/auth/me", { cache: "no-store" }).then(
      async (response) => {
        if (!active) return;
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) setError(await getApiError(response));
      },
    );
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="min-h-dvh bg-black text-[#f5f5f5]">
      <DashboardSidebar />
      <section className="ml-[100px] min-h-dvh py-8 pr-8 pb-12 transition-[margin] duration-200 peer-hover:ml-[250px] max-[900px]:ml-[250px] max-[900px]:py-6 max-[900px]:pr-5 max-[900px]:pb-10 max-[560px]:ml-0 max-[560px]:px-3 max-[560px]:pt-24 max-[560px]:pb-8">
        <div>
          <span className="text-xs text-[#5b5b5b]">{eyebrow}</span>
          <h1 className="mt-3 font-[var(--font-bricolage)] text-[clamp(32px,3vw,44px)] leading-[1.1]">
            {title}
          </h1>
          <p className="mt-2 text-sm text-[#b4b4b4]">{description}</p>
        </div>
        {error && <p className="mt-4 text-[13px] text-[#fca5a5]">{error}</p>}
        <section className="mt-7 min-h-[280px] overflow-hidden rounded-2xl border border-[#2c2c2c] bg-[#080808]">
          <header className="border-b border-[#2c2c2c] bg-[#191919] p-3 font-[var(--font-bricolage)] text-sm">
            {title}
          </header>
          <div className="flex flex-col gap-2 p-7">
            <strong className="font-[var(--font-bricolage)] text-lg">
              {title} workspace
            </strong>
            <p className="max-w-[520px] text-xs leading-[1.6] text-[#8a8d93]">
              Navigation is connected. The operational interface for this
              section will be added when we build this module.
            </p>
          </div>
        </section>
      </section>
    </main>
  );
}
