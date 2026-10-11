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
import { CircleAlert, RefreshCw } from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import {
  LeadGeographyMap,
  type GeographyPoint,
} from "@/components/dashboard/LeadGeographyMap";
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
  lead_geography: {
    points: GeographyPoint[];
    mapped_leads: number;
    unmapped_leads: number;
  };
};

const MONOCHROME = [
  "#f3f3f3",
  "#d4d4d4",
  "#adadad",
  "#858585",
  "#626262",
  "#464646",
  "#303030",
];

const panelClass =
  "overflow-hidden border border-white/[0.12] bg-[#101113] text-[#f2f2f2]";

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
    <div className="min-w-44 border border-white/15 bg-[#111214] px-3 py-2.5 text-[11px] shadow-xl">
      <p className="mb-2 text-[#858585]">{monthLabel(label) || label}</p>
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

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="mb-3 font-[Arial,Helvetica,sans-serif] text-[14px] font-semibold text-[#ededed]">
      {children}
    </h2>
  );
}

function PanelHeader({
  detail,
  title,
}: {
  detail?: string;
  title: string;
}) {
  return (
    <div className="flex min-h-14 items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
      <h3 className="font-[Arial,Helvetica,sans-serif] text-[12px] font-semibold leading-5">{title}</h3>
      {detail ? (
        <span className="shrink-0 text-[10px] text-[#777777]">{detail}</span>
      ) : null}
    </div>
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
        { cache: "no-store" },
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
      <main className="h-dvh overflow-hidden bg-[#090b0d] text-white">
        <DashboardSidebar />
        <div className="ml-[96px] flex h-dvh flex-col items-center justify-center pr-6 text-center">
          <CircleAlert className="size-6 text-white" />
          <h1 className="mt-4 text-lg font-semibold">
            Dashboard could not be loaded
          </h1>
          <p className="mt-2 max-w-md text-sm text-[#929292]">{error}</p>
          <button
            className="mt-5 border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white hover:text-black"
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
      <main className="h-dvh overflow-hidden bg-[#090b0d] text-white">
        <DashboardSidebar />
        <div className="ml-[96px] flex h-dvh items-center justify-center pr-6">
          <RefreshCw className="size-5 animate-spin text-white" />
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

  const kpis = [
    {
      detail: `${data.summary.open_opportunities} open opportunities`,
      label: "Open pipeline",
      value: money(data.summary.pipeline_value, true),
    },
    {
      detail: "Probability-adjusted value",
      label: "Weighted pipeline",
      value: money(data.summary.weighted_value, true),
    },
    {
      detail: `Won in the last ${days} days`,
      label: "Won revenue",
      value: money(data.summary.won_revenue, true),
    },
    {
      detail: `${data.summary.leads_qualified} of ${data.summary.leads_received} leads`,
      label: "Lead conversion",
      value: percent(data.summary.lead_conversion_rate),
    },
  ];

  return (
    <main className="h-dvh overflow-hidden bg-[#090b0d] text-white">
      <DashboardSidebar />
      <section className="ml-[96px] h-dvh overflow-y-auto font-[Arial,Helvetica,sans-serif] max-[700px]:ml-[84px]">
        <div className="mx-auto w-full max-w-[1680px] px-7 py-6 max-[700px]:px-3">
          <header className="flex items-end justify-between gap-8 border-b border-white/15 pb-5 max-[820px]:items-start max-[820px]:flex-col">
            <div>
              <p className="text-[11px] text-[#777777]">
                Performance overview
              </p>
              <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.02em]">
                Dashboard
              </h1>
              <p className="mt-2 text-[12px] text-[#858585]">
                Pipeline, conversion, inventory and team performance in one view.
              </p>
            </div>
            <div className="flex items-center gap-2 max-[620px]:w-full max-[620px]:flex-wrap">
              <select
                aria-label="Project"
                className="h-10 min-w-48 border border-white/20 bg-[#111315] px-3 text-[11px] text-white outline-none transition focus:border-white max-[620px]:min-w-0 max-[620px]:flex-1"
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
                className="h-10 border border-white/20 bg-[#111315] px-3 text-[11px] text-white outline-none transition focus:border-white"
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
                className="flex size-10 items-center justify-center border border-white/20 text-[#b5b5b5] transition hover:border-white hover:text-white disabled:opacity-40"
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

          <section className="mt-7">
            <SectionHeading>Executive overview</SectionHeading>
            <div className="grid grid-cols-4 gap-px overflow-hidden border border-white/[0.12] bg-white/[0.12] max-[1050px]:grid-cols-2 max-[620px]:grid-cols-1">
              {kpis.map(({ detail, label, value }) => (
                <article
                  className="min-h-36 bg-[#101113] px-5 py-5 text-[#f2f2f2]"
                  key={label}
                >
                  <p className="min-h-9 text-[12px] font-semibold leading-4">
                    {label}
                  </p>
                  <strong className="mt-4 block text-[34px] leading-none font-medium tracking-[-0.04em]">
                    {value}
                  </strong>
                  <p className="mt-2 text-[11px] leading-4 text-[#777777]">
                    {detail}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-9">
            <SectionHeading>Lead geography</SectionHeading>
            <article className={panelClass}>
              <PanelHeader
                detail="Scroll or use + / − to drill down"
                title="Geographic lead concentration"
              />
              <LeadGeographyMap
                mappedLeads={data.lead_geography.mapped_leads}
                points={data.lead_geography.points}
                unmappedLeads={data.lead_geography.unmapped_leads}
              />
            </article>
          </section>

          <section className="mt-9">
            <SectionHeading>Commercial outlook</SectionHeading>
            <div className="grid grid-cols-[minmax(0,1.65fr)_minmax(300px,.75fr)] gap-4 max-[1050px]:grid-cols-1">
              <article className={panelClass}>
                <PanelHeader
                  detail={`Last ${days} days`}
                  title="Actual revenue and weighted forecast"
                />
                <div className="relative h-[340px] px-3 pt-5 pb-3">
                  <ResponsiveContainer height="100%" width="100%">
                    <ComposedChart
                      data={data.revenue_forecast}
                      margin={{ bottom: 4, left: 0, right: 14, top: 8 }}
                    >
                      <defs>
                        <linearGradient id="revenueArea" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0" stopColor="#ffffff" stopOpacity={0.16} />
                          <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,0.10)" vertical={false} />
                      <XAxis
                        axisLine={false}
                        dataKey="month"
                        tick={{ fill: "#777777", fontSize: 10 }}
                        tickFormatter={monthLabel}
                        tickLine={false}
                      />
                      <YAxis
                        axisLine={false}
                        tick={{ fill: "#777777", fontSize: 10 }}
                        tickFormatter={(value) => money(value, true)}
                        tickLine={false}
                        width={62}
                      />
                      <Tooltip content={<RevenueTooltip />} />
                      <Area
                        dataKey="actual_revenue"
                        fill="url(#revenueArea)"
                        name="Actual revenue"
                        stroke="#ffffff"
                        strokeWidth={2.25}
                        type="monotone"
                      />
                      <Line
                        dataKey="weighted_forecast"
                        dot={false}
                        name="Weighted forecast"
                        stroke="#8b8b8b"
                        strokeDasharray="5 5"
                        strokeWidth={1.75}
                        type="monotone"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                  {!hasRevenueData ? (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 pt-12">
                      <div className="border border-white/15 bg-[#0b0c0e]/95 px-5 py-4 text-center shadow-xl">
                        <p className="text-xl font-semibold">
                          {money(data.summary.pipeline_value, true)} open pipeline
                        </p>
                        <p className="mt-1 text-[11px] text-[#858585]">
                          Add expected close dates to populate this forecast.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>

              <article className={panelClass}>
                <PanelHeader
                  detail={`${data.summary.open_opportunities} open`}
                  title="Pipeline by stage"
                />
                <div className="space-y-5 px-5 py-6">
                  {data.pipeline_by_stage.map((stage, index) => {
                    const value = Number(stage.pipeline_value ?? 0);
                    return (
                      <div key={String(stage.stage_key)}>
                        <div className="mb-2 flex items-end justify-between gap-4 text-[11px]">
                          <span className="truncate font-medium">
                            {String(stage.stage_name)}
                          </span>
                          <span className="shrink-0 text-[#a0a0a0]">
                            {money(value, true)}
                          </span>
                        </div>
                        <div className="h-2 bg-white/[0.08]">
                          <i
                            className="block h-full bg-white"
                            style={{
                              opacity: Math.max(0.3, 1 - index * 0.1),
                              width: `${(value / maxStageValue) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {!data.pipeline_by_stage.length ? (
                    <p className="py-16 text-center text-xs text-[#777777]">
                      No pipeline data yet
                    </p>
                  ) : null}
                </div>
              </article>
            </div>
          </section>

          <section className="mt-9">
            <SectionHeading>Conversion and acquisition</SectionHeading>
            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)] gap-4 max-[1050px]:grid-cols-1">
              <article className={panelClass}>
                <PanelHeader
                  detail={`${data.summary.leads_received} leads received`}
                  title="Conversion journey"
                />
                <div className="flex h-[300px] items-end gap-3 px-6 pt-8 pb-6">
                  {data.conversion_funnel.map((stage, index) => {
                    const value = Number(stage.records ?? 0);
                    return (
                      <div
                        className="flex min-w-0 flex-1 flex-col justify-end"
                        key={String(stage.stage)}
                      >
                        <span className="mb-2 text-[12px] font-semibold">
                          {value.toLocaleString("en-IN")}
                        </span>
                        <i
                          className="block min-h-1 w-full bg-white"
                          style={{
                            height: `${Math.max(6, (value / maxFunnel) * 190)}px`,
                            opacity: Math.max(0.28, 1 - index * 0.12),
                          }}
                        />
                        <span className="mt-2 truncate text-[10px] text-[#8b8b8b]">
                          {String(stage.stage)}
                        </span>
                      </div>
                    );
                  })}
                  {!data.conversion_funnel.length ? (
                    <p className="m-auto text-xs text-[#777777]">
                      No conversion data yet
                    </p>
                  ) : null}
                </div>
                <div className="grid grid-cols-3 border-t border-white/10 bg-black/15">
                  <div className="px-5 py-4">
                    <p className="text-[10px] text-[#858585]">Site visits</p>
                    <strong className="mt-1 block text-xl">
                      {data.summary.completed_site_visits}
                    </strong>
                  </div>
                  <div className="border-l border-white/10 px-5 py-4">
                    <p className="text-[10px] text-[#858585]">Converted visits</p>
                    <strong className="mt-1 block text-xl">
                      {data.summary.converted_site_visits}
                    </strong>
                  </div>
                  <div className="border-l border-white/10 px-5 py-4">
                    <p className="text-[10px] text-[#858585]">Visit conversion</p>
                    <strong className="mt-1 block text-xl">
                      {percent(data.summary.site_visit_conversion_rate)}
                    </strong>
                  </div>
                </div>
              </article>

              <article className={panelClass}>
                <PanelHeader detail="Top channels" title="Source performance" />
                <div className="px-5 py-4">
                  <div className="grid grid-cols-[minmax(0,1fr)_56px_72px] border-b border-white/10 pb-2 text-[9px] font-semibold tracking-[0.08em] text-[#777777] uppercase">
                    <span>Source</span>
                    <span className="text-right">Leads</span>
                    <span className="text-right">Conversion</span>
                  </div>
                  {data.source_performance.slice(0, 8).map((source) => {
                    const leads = Number(source.leads ?? 0);
                    return (
                      <div
                        className="grid grid-cols-[minmax(0,1fr)_56px_72px] items-center border-b border-white/[0.07] py-3 text-[11px] last:border-0"
                        key={String(source.source_name)}
                      >
                        <div className="min-w-0 pr-4">
                          <p className="truncate font-medium">
                            {String(source.source_name)}
                          </p>
                          <div className="mt-1.5 h-1 bg-white/[0.08]">
                            <i
                              className="block h-full bg-white"
                              style={{ width: `${(leads / maxSourceLeads) * 100}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-right">{leads}</span>
                        <span className="text-right text-[#9a9a9a]">
                          {percent(source.conversion_rate)}
                        </span>
                      </div>
                    );
                  })}
                  {!data.source_performance.length ? (
                    <p className="py-24 text-center text-xs text-[#777777]">
                      No source data yet
                    </p>
                  ) : null}
                </div>
              </article>
            </div>
          </section>

          <section className="mt-9">
            <SectionHeading>Inventory and team performance</SectionHeading>
            <div className="grid grid-cols-[minmax(320px,.72fr)_minmax(0,1.28fr)] gap-4 max-[1050px]:grid-cols-1">
              <article className={panelClass}>
                <PanelHeader
                  detail={`${data.summary.total_inventory} total units`}
                  title="Inventory status"
                />
                <div className="grid min-h-[310px] grid-cols-[190px_minmax(0,1fr)] items-center gap-3 px-5 py-6 max-[620px]:grid-cols-1">
                  <div className="relative mx-auto h-[180px] w-[180px]">
                    <ResponsiveContainer height="100%" width="100%">
                      <PieChart>
                        <Pie
                          data={data.inventory_mix}
                          dataKey="units"
                          innerRadius="63%"
                          nameKey="status"
                          outerRadius="89%"
                          paddingAngle={2}
                          stroke="none"
                        >
                          {data.inventory_mix.map((entry, index) => (
                            <Cell
                              fill={MONOCHROME[index % MONOCHROME.length]}
                              key={String(entry.status)}
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <strong className="text-3xl font-medium">
                        {data.summary.available_inventory}
                      </strong>
                      <span className="mt-1 text-[9px] tracking-[0.08em] text-[#858585] uppercase">
                        available
                      </span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {data.inventory_mix.map((item, index) => (
                      <div
                        className="flex items-center justify-between gap-4 text-[11px]"
                        key={String(item.status)}
                      >
                        <span className="flex min-w-0 items-center gap-2 capitalize text-[#a0a0a0]">
                          <i
                            className="size-2.5 shrink-0"
                            style={{
                              background: MONOCHROME[index % MONOCHROME.length],
                            }}
                          />
                          <span className="truncate">
                            {String(item.status).replaceAll("_", " ")}
                          </span>
                        </span>
                        <span className="font-semibold">
                          {item.units} · {percent((Number(item.units ?? 0) / inventoryTotal) * 100)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </article>

              <article className={panelClass}>
                <PanelHeader
                  detail={`${percent(data.summary.site_visit_conversion_rate)} site-visit conversion`}
                  title="Owner performance"
                />
                <div className="overflow-x-auto px-5 py-3">
                  <div className="grid min-w-[620px] grid-cols-[42px_minmax(180px,1fr)_95px_95px_115px] border-b border-white/10 py-2 text-[9px] font-semibold tracking-[0.08em] text-[#777777] uppercase">
                    <span>Rank</span>
                    <span>Owner</span>
                    <span className="text-right">Open</span>
                    <span className="text-right">Win rate</span>
                    <span className="text-right">Won revenue</span>
                  </div>
                  {data.owner_performance.map((owner, index) => (
                    <div
                      className="grid min-w-[620px] grid-cols-[42px_minmax(180px,1fr)_95px_95px_115px] items-center border-b border-white/[0.07] py-3 text-[11px] last:border-0"
                      key={String(owner.user_id)}
                    >
                      <span className="text-[#777777]">{index + 1}</span>
                      <span className="truncate pr-5 font-medium">
                        {String(owner.owner_name)}
                      </span>
                      <span className="text-right">
                        {owner.open_opportunities}
                      </span>
                      <span className="text-right text-[#a0a0a0]">
                        {percent(owner.win_rate)}
                      </span>
                      <strong className="text-right font-semibold">
                        {money(owner.won_revenue, true)}
                      </strong>
                    </div>
                  ))}
                  {!data.owner_performance.length ? (
                    <p className="py-24 text-center text-xs text-[#777777]">
                      No owner data yet
                    </p>
                  ) : null}
                </div>
              </article>
            </div>
          </section>

          <footer className="mt-8 flex items-center justify-between border-t border-white/10 py-5 text-[9px] text-[#666666] max-[620px]:items-start max-[620px]:gap-3 max-[620px]:flex-col">
            <span>Live CRM reporting · company and project scoped</span>
            <span>
              Updated{" "}
              {new Intl.DateTimeFormat("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(data.generated_at))}
            </span>
          </footer>
        </div>
      </section>
    </main>
  );
}
