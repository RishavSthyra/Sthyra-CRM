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
  76, 86, 98, 98, 94, 86, 98, 98, 98, 98, 94, 86, 98, 98, 98, 98, 98, 98,
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
    <div className="dashboard-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
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
      className={`dashboard-widget ${wide ? "dashboard-widget-wide" : ""}`}
    >
      <header>{title}</header>
      <div className="dashboard-widget-body">{children}</div>
    </section>
  );
}

function Donut({ small = false }: { small?: boolean }) {
  return (
    <div className={`dashboard-donut ${small ? "is-small" : ""}`}>
      <div>{small && "+9.1%"}</div>
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
    <main className="dashboard-page">
      <DashboardSidebar />
      <section className="dashboard-content">
        <div className="dashboard-heading">
          <span>Workspace</span>
          <h1>Dashboard</h1>
          <p>Sharper insights, faster decisions.</p>
        </div>
        {error && <p className="dashboard-error">{error}</p>}
        <section className="dashboard-overview">
          <header>Overview</header>
          <div className="dashboard-metrics">
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
        <div className="dashboard-grid dashboard-grid-primary">
          <Widget title="Availability mix" wide>
            <Donut />
          </Widget>
          <Widget title="Floor status" wide>
            <div className="dashboard-line-chart">
              <div className="dashboard-chart-grid" />
              <div className="dashboard-line" aria-hidden="true">
                {linePoints.slice(0, -1).map(([x, y], index) => {
                  const [nextX, nextY] = linePoints[index + 1];
                  const length = Math.hypot(nextX - x, nextY - y);
                  const angle =
                    (Math.atan2(nextY - y, nextX - x) * 180) / Math.PI;
                  return (
                    <i
                      key={`${x}-${y}`}
                      style={{
                        left: `${x}px`,
                        top: `${y}px`,
                        width: `${length}px`,
                        transform: `rotate(${angle}deg)`,
                      }}
                    />
                  );
                })}
              </div>
              <div className="dashboard-chart-labels">
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
        <div className="dashboard-grid dashboard-grid-secondary">
          <Widget title="Availability mix">
            <Donut small />
          </Widget>
          <Widget title="Availability mix">
            <div className="dashboard-progress-list">
              {[
                ["Hourly", "30%", 30],
                ["Daily", "30%", 66],
                ["Weekly", "20%", 44],
                ["Monthly", "20%", 26],
              ].map(([label, value, width]) => (
                <div key={String(label)}>
                  <div>
                    <span>{label}</span>
                    <small>{value}</small>
                  </div>
                  <i>
                    <b style={{ width: `${width}%` }} />
                  </i>
                </div>
              ))}
            </div>
          </Widget>
          <Widget title="Floor status">
            <div className="dashboard-bars">
              {bars.map((height, index) => (
                <i key={index} style={{ height: `${height}%` }}>
                  <b />
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
