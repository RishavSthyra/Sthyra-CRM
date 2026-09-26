"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";

const linePoints = [
  [0, 80],
  [45, 62],
  [90, 76],
  [135, 40],
  [180, 43],
  [225, 68],
  [270, 34],
  [315, 20],
  [360, 52],
  [405, 55],
  [450, 33],
  [495, 19],
];
const bars = [
  "h-[76%]",
  "h-[86%]",
  "h-[98%]",
  "h-[98%]",
  "h-[94%]",
  "h-[86%]",
  "h-[98%]",
  "h-[98%]",
  "h-[98%]",
  "h-[98%]",
  "h-[94%]",
  "h-[86%]",
  "h-[98%]",
  "h-[98%]",
  "h-[98%]",
  "h-[98%]",
  "h-[98%]",
  "h-[98%]",
];

type CurrentUser = {
  first_name?: string;
  last_name?: string | null;
  email?: string;
  username?: string;
};

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-r border-[#2c2c2c] px-6 first:pl-0 last:border-r-0 max-[900px]:px-6 max-[560px]:px-2.5 [&:nth-child(2)]:max-[900px]:border-r-0">
      <span className="text-[11px] text-[#b4b4b4]">{label}</span>
      <strong className="text-[32px] leading-none max-[560px]:text-[26px]">
        {value}
      </strong>
      <small className="text-[11px] text-[#b4b4b4]">{detail}</small>
    </div>
  );
}

function Widget({
  children,
  title,
  wide = false,
}: {
  children: React.ReactNode;
  title: string;
  wide?: boolean;
}) {
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-2xl border border-[#2c2c2c] bg-[#080808] ${wide ? "" : ""}`}
    >
      <header className="border-b border-[#2c2c2c] bg-[#191919] p-3 font-[var(--font-bricolage)] text-sm text-[#f5f5f5]">
        {title}
      </header>
      <div className={`p-4 ${wide ? "min-h-[230px]" : "min-h-[205px]"}`}>
        {children}
      </div>
    </section>
  );
}

function Donut({ small = false }: { small?: boolean }) {
  return (
    <div
      className={`relative mx-auto my-2.5 flex items-center justify-center rounded-full border-[10px] border-[#080808] bg-[conic-gradient(#f5f5f5_0_22%,#8a8d93_22%_57%,#343434_57%_100%)] after:absolute after:rounded-full after:bg-[#080808] ${
        small
          ? "size-[122px] after:inset-[23px]"
          : "size-[154px] after:inset-[25px]"
      }`}
    >
      <div className="relative z-[1] text-xs text-[#15133d]">
        {small && "+9.1%"}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
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

  return (
    <main className="min-h-dvh bg-black text-[#f5f5f5]">
      <DashboardSidebar />
      <section className="ml-[96px] min-h-dvh py-8 pr-8 pb-12 max-[900px]:py-6 max-[900px]:pr-5 max-[900px]:pb-10 max-[560px]:ml-[84px] max-[560px]:px-3 max-[560px]:py-5 max-[560px]:pb-8">
        <div>
          <span className="text-xs text-[#5b5b5b]">Workspace</span>
          <h1 className="mt-3 font-[var(--font-bricolage)] text-[clamp(32px,3vw,44px)] leading-[1.1]">
            Dashboard
          </h1>
          <p className="mt-2 text-sm text-[#b4b4b4]">
            Sharper insights, faster decisions.
          </p>
        </div>
        {error && <p className="mt-4 text-[13px] text-[#fca5a5]">{error}</p>}
        <section className="mt-7 overflow-hidden rounded-2xl border border-[#2c2c2c]">
          <header className="border-b border-[#2c2c2c] bg-[#191919] p-3 font-[var(--font-bricolage)] text-sm text-[#f5f5f5]">
            Overview
          </header>
          <div className="grid grid-cols-4 bg-[#080808] px-4 py-6 max-[900px]:grid-cols-2 max-[900px]:gap-y-[22px] max-[560px]:grid-cols-2 max-[560px]:px-3 max-[560px]:py-[18px]">
            <Metric
              detail="All towers in scope"
              label="Units in scope"
              value="400"
            />
            <Metric detail="96% ready to sell" label="Available" value="386" />
            <Metric detail="2% held in pipeline" label="Reserved" value="9" />
            <Metric detail="2% fully closed" label="Sold" value="8" />
          </div>
        </section>
        <div className="mt-3 grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
          <Widget title="Availability mix" wide>
            <Donut />
          </Widget>
          <Widget title="Floor status" wide>
            <div className="relative h-[194px]">
              <div className="mt-3 h-[130px] bg-[repeating-linear-gradient(to_bottom,transparent_0_38px,#555_39px_40px)] opacity-65" />
              <div
                aria-hidden="true"
                className="absolute top-3 right-2 left-2 h-[130px] overflow-hidden"
              >
                {linePoints.slice(0, -1).map(([x, y], index) => {
                  const [nextX, nextY] = linePoints[index + 1];
                  const width = Math.hypot(nextX - x, nextY - y);
                  const angle =
                    Math.atan2(nextY - y, nextX - x) * (180 / Math.PI);
                  return (
                    <i
                      className="absolute h-0.5 origin-left bg-[#f5f5f5]"
                      key={`${x}-${y}`}
                      style={{
                        left: `${(x / 495) * 100}%`,
                        top: `${(y / 130) * 100}%`,
                        transform: `rotate(${angle}deg)`,
                        width: `${(width / 495) * 100}%`,
                      }}
                    />
                  );
                })}
              </div>
              <div className="absolute right-0 bottom-0 left-0 flex justify-between text-[9px] text-[#8a8d93]">
                {[
                  "Jan",
                  "Feb",
                  "Mar",
                  "Apr",
                  "May",
                  "Jun",
                  "Jul",
                  "Aug",
                  "Sep",
                  "Oct",
                  "Nov",
                  "Dec",
                ].map((month) => (
                  <span key={month}>{month}</span>
                ))}
              </div>
            </div>
          </Widget>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 max-[900px]:grid-cols-1">
          <Widget title="Availability mix">
            <Donut small />
          </Widget>
          <Widget title="Availability mix">
            <div className="mt-[26px] flex flex-col gap-[15px]">
              {[
                ["Hourly", "30%", "w-[30%]"],
                ["Daily", "30%", "w-[66%]"],
                ["Weekly", "20%", "w-[44%]"],
                ["Monthly", "20%", "w-[26%]"],
              ].map(([label, value, width]) => (
                <div key={String(label)}>
                  <div className="flex justify-between text-[10px] text-[#8a8d93]">
                    <span>{label}</span>
                    <small>{value}</small>
                  </div>
                  <i className="mt-[5px] block h-1.5 overflow-hidden rounded bg-[#f5f5f5]">
                    <b
                      className={`block h-full bg-[linear-gradient(90deg,#444,#999)] ${width}`}
                    />
                  </i>
                </div>
              ))}
            </div>
          </Widget>
          <Widget title="Floor status">
            <div className="flex h-[155px] items-end justify-between gap-3 px-1.5">
              {bars.map((height, index) => (
                <i
                  className={`block w-full max-w-[13px] rounded-t bg-[linear-gradient(#f5f5f5_0_48%,#777_48%_100%)] ${height}`}
                  key={index}
                >
                  <b className="block h-[42%] bg-[linear-gradient(#f5f5f5,#777)] opacity-65" />
                </i>
              ))}
            </div>
          </Widget>
        </div>
        <span className="sr-only">{user?.first_name ?? ""}</span>
      </section>
    </main>
  );
}
