"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";

type CurrentUser = {
  first_name?: string;
  last_name?: string | null;
  email?: string;
  username?: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchWithSession("/api/auth/me", { cache: "no-store" }).then(
      async (response) => {
        if (!active) {
          return;
        }
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setError(await getApiError(response));
          return;
        }
        const body = (await response.json()) as { user: CurrentUser };
        setUser(body.user);
      },
    );
    return () => {
      active = false;
    };
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#050505] p-6 text-white">
      <section className="auth-panel w-full max-w-2xl rounded-2xl border border-white/10 p-8 shadow-2xl">
        <p className="text-sm font-medium tracking-[0.2em] text-emerald-200/70 uppercase">
          Sthyra CRM
        </p>
        <h1 className="mt-3 font-heading text-4xl font-medium">
          {user ? `Welcome, ${user.first_name ?? user.username}` : "Loading…"}
        </h1>
        <p className="mt-3 text-white/70">
          {error ?? user?.email ?? "Checking your session"}
        </p>
        <div className="mt-8 flex gap-3">
          <button
            className="auth-submit rounded-xl px-5 py-3 font-medium"
            onClick={logout}
            type="button"
          >
            Log out
          </button>
        </div>
      </section>
    </main>
  );
}
