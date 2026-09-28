"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Area,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight,
  CircleAlert,
  RefreshCw,
  Target,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";

type DataRow = Record<string, string | number | null>;

type Analytics = {
  generated_at: string;
  projects: Array<{ project_id: number; project_name: string }>;
  summary: {
    open_opportunities: number;
    pipeline_value: number;
    weighted_value: number;
    won_revenue: number;
    leads_received: number;
    leads_qualified: number;
    lead_conversion_rate: number;
    completed_site_visits: number;
    converted_site_visits: number;
    site_visit_conversion_rate: number;
    total_inventory: number;
    available_inventory: number;
  };
  pipeline_by_stage: DataRow[];
  source_performance: DataRow[];
  owner_performance: DataRow[];
  inventory_mix: DataRow[];
  revenue_forecast: DataRow[];
  conversion_funnel: DataRow[];
};

const EMERALDS = [
  "#61d6b2",
  "#36a985",
  "#23765f",
  "#175141",
  "#aeb8b3",
  "#68726d",
  "#39413d",
];

function money(value: unknown, compact = false) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? "compact" : "standard",
  }).format(Number(value ?? 0));
}

function percent(value: unknown) {
  return `${Number(value ?? 0).toFixed(1)}%`;
}

function monthLabel(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return "";
  }
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "2-digit",
  }).format(date);
}

function RevenueTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-44 border border-white/[0.13] bg-[#0d1210] px-3 py-2.5 text-[11px] shadow-2xl">
      <p className="mb-2 text-[#7c8781]">{monthLabel(label) || label}</p>
      {payload.map((item) => (
        <div
          className="flex items-center justify-between gap-6 py-1"
          key={item.name}
        >
          <span style={{ color: item.color }}>{item.name}</span>
          <strong className="text-white">{money(item.value, true)}</strong>
        </div>
      ))}
    </div>
  );
}

function Label({ children }: { children: string }) {
  return (
    <p className="text-[9px] font-semibold tracking-[0.16em] text-[#66716b] uppercase">
      {children}
    </p>
  );
}

export function AnalyticsDashboard() {
  const [data, setData] = useState<Analytics | null>(null);
  const [days, setDays] = useState(90);
  const [projectId, setProjectId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ days: String(days) });
    if (projectId) query.set("project_id", projectId);
    try {
      const response = await fetchWithSession(
        `/api/dashboard/analytics?${query}`,
        {
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error(await getApiError(response));
      setData((await response.json()) as Analytics);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to load analytics",
      );
    } finally {
      setLoading(false);
    }
  }, [days, projectId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  if (error) {
    return (
      <main className="h-dvh overflow-hidden bg-[#050706] text-white">
        <DashboardSidebar />
        <div className="ml-[96px] flex h-dvh flex-col items-center justify-center pr-6 text-center">
          <CircleAlert className="size-6 text-[#61d6b2]" />
          <h1 className="mt-4 text-lg font-semibold">
            Dashboard could not be loaded
          </h1>
          <p className="mt-2 max-w-md text-sm text-[#7e8983]">{error}</p>
          <button
            className="mt-5 text-xs font-semibold text-[#61d6b2]"
            onClick={() => void load()}
            type="button"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="h-dvh overflow-hidden bg-[#050706] text-white">
        <DashboardSidebar />
        <div className="ml-[96px] flex h-dvh items-center justify-center pr-6">
          <RefreshCw className="size-5 animate-spin text-[#61d6b2]" />
        </div>
      </main>
    );
  }

  const maxStageValue = Math.max(
    1,
    ...data.pipeline_by_stage.map((stage) => Number(stage.pipeline_value ?? 0)),
  );
  const maxFunnel = Math.max(
    1,
    ...data.conversion_funnel.map((stage) => Number(stage.records ?? 0)),
  );
  const topOwners = data.owner_performance.slice(0, 4);
  const maxSourceLeads = Math.max(
    1,
    ...data.source_performance.map((source) => Number(source.leads ?? 0)),
  );
  const hasRevenueData = data.revenue_forecast.some(
    (month) =>
      Number(month.actual_revenue ?? 0) > 0 ||
      Number(month.weighted_forecast ?? 0) > 0,
  );
  const inventoryTotal = Math.max(
    1,
    data.inventory_mix.reduce(
      (total, item) => total + Number(item.units ?? 0),
      0,
    ),
  );

  return (
    <main className="h-dvh overflow-hidden bg-[#050706] text-[#eef2f0]">
      <DashboardSidebar />
      <section className="ml-[96px] flex h-dvh min-h-0 flex-col overflow-hidden py-4 pr-6 max-[700px]:ml-[84px] max-[700px]:pr-3">
        <header className="flex h-[66px] shrink-0 items-center justify-between gap-6 border-b border-white/[0.09]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-[#61d6b2]" />
              <Label>Revenue intelligence</Label>
            </div>
            <h1 className="mt-1 font-[var(--font-bricolage)] text-[28px] leading-none tracking-[-0.03em]">
              Dashboard
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Project"
              className="h-9 max-w-48 border-0 border-b border-white/[0.12] bg-transparent px-2 text-[10px] text-[#aeb7b2] outline-none focus:border-[#61d6b2]"
              onChange={(event) => setProjectId(event.target.value)}
              value={projectId}
            >
              <option value="">All accessible projects</option>
              {data.projects.map((project) => (
                <option key={project.project_id} value={project.project_id}>
                  {project.project_name}
                </option>
              ))}
            </select>
            <select
              aria-label="Reporting period"
              className="h-9 border-0 border-b border-white/[0.12] bg-transparent px-2 text-[10px] text-[#aeb7b2] outline-none focus:border-[#61d6b2]"
              onChange={(event) => setDays(Number(event.target.value))}
              value={days}
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>6 months</option>
              <option value={365}>12 months</option>
            </select>
            <button
              aria-label="Refresh analytics"
              className="flex size-9 items-center justify-center text-[#6f7974] transition hover:text-white disabled:opacity-40"
              disabled={loading}
              onClick={() => void load()}
              type="button"
            >
              <RefreshCw
                className={`size-3.5 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </header>

        <section className="grid h-[104px] shrink-0 grid-cols-4 border-b border-white/[0.09] max-[980px]:grid-cols-2">
          {[
            {
              detail: `${data.summary.open_opportunities} opportunities`,
              icon: Target,
              label: "Open pipeline",
              value: money(data.summary.pipeline_value, true),
            },
            {
              detail: "Probability adjusted",
              icon: TrendingUp,
              label: "Weighted pipeline",
              value: money(data.summary.weighted_value, true),
            },
            {
              detail: `Last ${days} days`,
              icon: ArrowUpRight,
              label: "Won revenue",
              value: money(data.summary.won_revenue, true),
            },
            {
              detail: `${data.summary.leads_qualified} of ${data.summary.leads_received} leads`,
              icon: UsersRound,
              label: "Lead conversion",
              value: percent(data.summary.lead_conversion_rate),
            },
          ].map(({ detail, icon: Icon, label, value }, index) => (
            <div
              className={`flex min-w-0 flex-col justify-center px-5 first:pl-0 ${index ? "border-l border-white/[0.09]" : ""}`}
              key={label}
            >
              <div className="flex items-center gap-2 text-[#78837d]">
                <Icon className="size-3.5 text-[#61d6b2]" />
                <span className="truncate text-[9px] font-medium tracking-[0.13em] uppercase">
                  {label}
                </span>
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <strong className="font-[var(--font-bricolage)] text-[24px] leading-none font-medium">
                  {value}
                </strong>
                <span className="truncate text-[9px] text-[#58615c]">
                  {detail}
                </span>
              </div>
            </div>
          ))}
        </section>

        <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.72fr)_minmax(280px,.62fr)] border-b border-white/[0.09] max-[1080px]:grid-cols-[minmax(0,1.4fr)_280px]">
          <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1.05fr)_minmax(210px,.95fr)] border-r border-white/[0.09]">
            <div className="flex min-h-0 flex-col">
              <div className="flex shrink-0 items-center justify-between px-5 pt-4 pb-1 first:pl-0">
                <div>
                  <Label>Revenue outlook</Label>
                  <h2 className="mt-1.5 text-[15px] font-medium">
                    Actual revenue and weighted forecast
                  </h2>
                </div>
                <div className="flex gap-4 text-[9px] text-[#737d78]">
                  <span className="flex items-center gap-1.5">
                    <i className="size-1.5 rounded-full bg-[#61d6b2]" />
                    Actual
                  </span>
                  <span className="flex items-center gap-1.5">
                    <i className="size-1.5 rounded-full bg-white" />
                    Forecast
                  </span>
                </div>
              </div>
              <div className="relative min-h-0 flex-1 pt-2 pr-3">
                <ResponsiveContainer height="100%" width="100%">
                  <ComposedChart
                    data={data.revenue_forecast}
                    margin={{ bottom: 2, left: 0, right: 8, top: 12 }}
                  >
                    <defs>
                      <linearGradient
                        id="revenueArea"
                        x1="0"
                        x2="0"
                        y1="0"
                        y2="1"
                      >
                        <stop
                          offset="0"
                          stopColor="#61d6b2"
                          stopOpacity={0.28}
                        />
                        <stop offset="1" stopColor="#61d6b2" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="rgba(255,255,255,.055)"
                      vertical={false}
                    />
                    <XAxis
                      axisLine={false}
                      dataKey="month"
                      tick={{ fill: "#59635e", fontSize: 9 }}
                      tickFormatter={monthLabel}
                      tickLine={false}
                    />
                    <YAxis
                      axisLine={false}
                      tick={{ fill: "#59635e", fontSize: 9 }}
                      tickFormatter={(value) => money(value, true)}
                      tickLine={false}
                      width={56}
                    />
                    <Tooltip content={<RevenueTooltip />} />
                    <Area
                      dataKey="actual_revenue"
                      fill="url(#revenueArea)"
                      name="Actual revenue"
                      stroke="#61d6b2"
                      strokeWidth={2.2}
                      type="monotone"
                    />
                    <Line
                      dataKey="weighted_forecast"
                      dot={false}
                      name="Weighted forecast"
                      stroke="#f0f3f1"
                      strokeDasharray="4 5"
                      strokeOpacity={0.8}
                      strokeWidth={1.6}
                      type="monotone"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
                {!hasRevenueData && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-6">
                    <div className="border-l border-[#61d6b2] bg-[#080c0a]/90 px-5 py-3">
                      <p className="text-[18px] font-medium text-white">
                        {money(data.summary.pipeline_value, true)} open pipeline
                      </p>
                      <p className="mt-1 text-[9px] text-[#68736d]">
                        Add expected close dates to populate the revenue
                        forecast.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="grid min-h-0 grid-cols-[1.08fr_.92fr] border-t border-white/[0.09]">
              <div className="flex min-h-0 min-w-0 flex-col px-5 py-4 first:pl-0">
                <div className="flex items-center justify-between">
                  <Label>Conversion journey</Label>
                  <span className="text-[9px] text-[#59635e]">
                    {days} day cohort
                  </span>
                </div>
                <div className="mt-4 flex min-h-0 flex-1 items-end gap-2 pb-1">
                  {data.conversion_funnel.map((stage, index) => {
                    const value = Number(stage.records ?? 0);
                    return (
                      <div
                        className="flex min-w-0 flex-1 flex-col justify-end"
                        key={String(stage.stage)}
                      >
                        <span className="mb-1 text-[9px] font-medium text-[#d7ddda]">
                          {value}
                        </span>
                        <i
                          className="block min-h-1 w-full bg-[#61d6b2]"
                          style={{
                            height: `${Math.max(5, (value / maxFunnel) * 88)}px`,
                            opacity: Math.max(0.28, 1 - index * 0.12),
                          }}
                        />
                        <span className="mt-1.5 truncate text-[8px] text-[#626c66]">
                          {String(stage.stage)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="min-h-0 border-l border-white/[0.09] px-5 py-4">
                <div className="flex items-center justify-between">
                  <Label>Source performance</Label>
                  <span className="text-[9px] text-[#59635e]">
                    Top channels
                  </span>
                </div>
                <div className="mt-3 space-y-3">
                  {data.source_performance.slice(0, 4).map((source) => {
                    const leads = Number(source.leads ?? 0);
                    return (
                      <div key={String(source.source_name)}>
                        <div className="mb-1 flex items-center justify-between gap-3 text-[9px]">
                          <span className="truncate text-[#a6afaa]">
                            {String(source.source_name)}
                          </span>
                          <span className="shrink-0 text-[#64706a]">
                            {leads} leads · {percent(source.conversion_rate)}
                          </span>
                        </div>
                        <div className="h-1 overflow-hidden bg-white/[0.055]">
                          <i
                            className="block h-full bg-[#61d6b2]"
                            style={{
                              width: `${(leads / maxSourceLeads) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {!data.source_performance.length && (
                    <p className="pt-6 text-center text-[9px] text-[#58615c]">
                      No source data yet
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <aside className="grid min-h-0 grid-rows-[minmax(190px,1fr)_170px_minmax(155px,.8fr)]">
            <div className="min-h-0 px-5 py-4">
              <div className="flex items-center justify-between">
                <Label>Pipeline by stage</Label>
                <span className="text-[9px] text-[#56605a]">
                  {data.summary.open_opportunities} open
                </span>
              </div>
              <div className="mt-3 space-y-2.5">
                {data.pipeline_by_stage.map((stage, index) => {
                  const value = Number(stage.pipeline_value ?? 0);
                  return (
                    <div key={String(stage.stage_key)}>
                      <div className="mb-1 flex items-center justify-between gap-3 text-[9px]">
                        <span className="truncate text-[#9aa49f]">
                          {String(stage.stage_name)}
                        </span>
                        <strong className="shrink-0 font-medium text-[#dce2df]">
                          {money(value, true)}
                        </strong>
                      </div>
                      <div className="h-1 overflow-hidden bg-white/[0.055]">
                        <i
                          className="block h-full bg-[#61d6b2]"
                          style={{
                            opacity: Math.max(0.35, 1 - index * 0.1),
                            width: `${(value / maxStageValue) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-[122px_1fr] border-t border-white/[0.09] px-5 py-4">
              <div className="relative h-[122px]">
                <ResponsiveContainer height="100%" width="100%">
                  <PieChart>
                    <Pie
                      data={data.inventory_mix}
                      dataKey="units"
                      innerRadius="61%"
                      nameKey="status"
                      outerRadius="88%"
                      paddingAngle={2}
                      stroke="none"
                    >
                      {data.inventory_mix.map((entry, index) => (
                        <Cell
                          fill={EMERALDS[index % EMERALDS.length]}
                          key={String(entry.status)}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <strong className="text-[16px]">
                    {data.summary.available_inventory}
                  </strong>
                  <span className="text-[7px] tracking-[.12em] text-[#5d6761] uppercase">
                    available
                  </span>
                </div>
              </div>
              <div className="flex min-w-0 flex-col justify-center pl-3">
                <Label>Inventory</Label>
                <p className="mt-2 text-[11px] text-[#aeb7b2]">
                  {inventoryTotal.toLocaleString("en-IN")} total units
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {data.inventory_mix.slice(0, 4).map((item, index) => (
                    <span
                      className="flex items-center gap-1 text-[8px] capitalize text-[#66716b]"
                      key={String(item.status)}
                    >
                      <i
                        className="size-1.5 rounded-full"
                        style={{
                          background: EMERALDS[index % EMERALDS.length],
                        }}
                      />
                      {String(item.status).replaceAll("_", " ")} {item.units}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="min-h-0 border-t border-white/[0.09] px-5 py-4">
              <div className="flex items-center justify-between">
                <Label>Owner performance</Label>
                <span className="text-[9px] text-[#61d6b2]">
                  {percent(data.summary.site_visit_conversion_rate)} visit
                  conversion
                </span>
              </div>
              <div className="mt-2">
                {topOwners.length ? (
                  topOwners.map((owner, index) => (
                    <div
                      className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 border-b border-white/[0.055] py-1.5 last:border-0"
                      key={String(owner.user_id)}
                    >
                      <span className="flex size-5 items-center justify-center rounded-full bg-white/[0.06] text-[7px] text-[#aeb7b2]">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[9px] text-[#cbd2ce]">
                          {String(owner.owner_name)}
                        </p>
                        <p className="text-[7px] text-[#56605a]">
                          {owner.open_opportunities} open ·{" "}
                          {percent(owner.win_rate)} win
                        </p>
                      </div>
                      <strong className="text-[9px] font-medium text-[#61d6b2]">
                        {money(owner.won_revenue, true)}
                      </strong>
                    </div>
                  ))
                ) : (
                  <p className="pt-6 text-center text-[9px] text-[#58615c]">
                    No owner data yet
                  </p>
                )}
              </div>
            </div>
          </aside>
        </section>

        <footer className="flex h-[24px] shrink-0 items-end justify-between text-[8px] text-[#434b47]">
          <span>Live CRM reporting · company and project scoped</span>
          <span>
            Updated{" "}
            {new Intl.DateTimeFormat("en-IN", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(data.generated_at))}
          </span>
        </footer>
      </section>
    </main>
  );
}
