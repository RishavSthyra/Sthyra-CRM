"use client";

import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  Link2,
  LoaderCircle,
  Megaphone,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { fetchWithSession } from "@/lib/clientAuth";

type Tab =
  "overview" | "touchpoints" | "forms" | "integrations" | "conversions";
type RecordValue = Record<string, unknown>;
type Overview = {
  summary: RecordValue;
  trend: RecordValue[];
  sources: RecordValue[];
  touchpoints: RecordValue[];
  conversions: RecordValue[];
  projects: RecordValue[];
  lead_sources: RecordValue[];
  campaigns: RecordValue[];
  selected_project_id: number | null;
};

const tabs: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "touchpoints", label: "Touchpoints" },
  { key: "forms", label: "Forms & webhooks" },
  { key: "integrations", label: "Integrations" },
  { key: "conversions", label: "Conversions" },
];

function asNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function shortDate(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

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
    <div className="min-w-0 border-r border-[#2c2c2c] px-4 py-4 last:border-r-0 max-[900px]:border-b max-[900px]:border-[#2c2c2c] max-[520px]:border-r-0">
      <div className="text-[11px] font-medium text-[#929292]">{label}</div>
      <div className="mt-2">
        <strong className="block truncate text-2xl leading-none font-semibold tracking-[-0.03em] text-white">
          {value}
        </strong>
        <span className="mt-1.5 block truncate text-[11px] text-[#707070]">
          {detail}
        </span>
      </div>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center text-center">
      <div className="flex size-10 items-center justify-center rounded-full border border-white/[0.09] bg-white/[0.03]">
        <Megaphone className="size-4 text-[#68706d]" />
      </div>
      <h3 className="mt-4 text-sm font-medium text-[#d8ddda]">{title}</h3>
      <p className="mt-1 max-w-md text-xs text-[#68706d]">{body}</p>
    </div>
  );
}

function Dialog({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm">
      <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/[0.12] bg-[#101513] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-white/[0.08] bg-[#101513]/95 px-6 py-5 backdrop-blur">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-xs text-[#7b8480]">{subtitle}</p>
          </div>
          <button
            className="rounded-lg p-2 text-[#808985] hover:bg-white/[0.06] hover:text-white"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputClass =
  "h-11 w-full rounded-lg border border-white/[0.11] bg-[#080b0a] px-3 text-sm text-white outline-none transition focus:border-[#50cdaa]/60 focus:ring-2 focus:ring-[#50cdaa]/10";
const labelClass = "mb-1.5 block text-[11px] font-medium text-[#8a928f]";

function SelectControl({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={`relative ${className}`}>
      <select
        {...props}
        className="h-11 w-full cursor-pointer appearance-none rounded-[10px] border border-[#363636] bg-[#151515] py-0 pr-10 pl-4 text-sm text-[#d8d8d8] outline-none transition focus:border-[#50cdaa]/70"
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-[#89918e]"
      />
    </div>
  );
}

export function MarketingWorkspace() {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [forms, setForms] = useState<RecordValue[]>([]);
  const [integrations, setIntegrations] = useState<RecordValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [project, setProject] = useState("");
  const [days, setDays] = useState("30");
  const [formDialog, setFormDialog] = useState(false);
  const [integrationDialog, setIntegrationDialog] = useState(false);
  const [credentials, setCredentials] = useState<RecordValue | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const suffix = new URLSearchParams({
        days,
        ...(project ? { project_id: project } : {}),
      });
      const [overviewResponse, formsResponse, integrationsResponse] =
        await Promise.all([
          fetchWithSession(`/api/marketing/overview?${suffix}`, {
            cache: "no-store",
          }),
          fetchWithSession("/api/marketing/forms", { cache: "no-store" }),
          fetchWithSession("/api/marketing/integrations", {
            cache: "no-store",
          }),
        ]);
      if (
        !overviewResponse.ok ||
        !formsResponse.ok ||
        !integrationsResponse.ok
      ) {
        const failed = !overviewResponse.ok
          ? overviewResponse
          : !formsResponse.ok
            ? formsResponse
            : integrationsResponse;
        const body = (await failed.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || "Marketing data could not be loaded");
      }
      const [overviewBody, formsBody, integrationsBody] = await Promise.all([
        overviewResponse.json(),
        formsResponse.json(),
        integrationsResponse.json(),
      ]);
      setOverview(overviewBody as Overview);
      setForms((formsBody as { forms?: RecordValue[] }).forms ?? []);
      setIntegrations(
        (integrationsBody as { integrations?: RecordValue[] }).integrations ??
          [],
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Marketing data could not be loaded",
      );
    } finally {
      setLoading(false);
    }
  }, [days, project]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const summary = overview?.summary ?? {};
  const chartData = useMemo(
    () =>
      (overview?.trend ?? []).map((row) => ({
        ...row,
        label: new Intl.DateTimeFormat("en-IN", {
          day: "numeric",
          month: "short",
        }).format(new Date(String(row.day))),
      })),
    [overview?.trend],
  );

  async function patchForm(formId: string, payload: RecordValue) {
    const response = await fetchWithSession(
      `/api/marketing/forms/manage/${formId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const body = (await response.json().catch(() => ({}))) as RecordValue;
    if (!response.ok)
      throw new Error(String(body.error ?? "Unable to update form"));
    if (body.credentials)
      setCredentials({ ...(body.credentials as RecordValue), form: body.form });
    await load();
  }

  async function retryConversion(id: string) {
    const promise = fetchWithSession(`/api/marketing/conversions/${id}/retry`, {
      method: "POST",
    }).then(async (response) => {
      if (!response.ok)
        throw new Error(
          ((await response.json().catch(() => ({}))) as { error?: string })
            .error || "Unable to retry conversion",
        );
      await load();
    });
    toast.promise(promise, {
      loading: "Queueing retry…",
      success: "Conversion queued",
      error: (cause) => cause.message,
    });
  }

  return (
    <div className="min-h-dvh bg-black text-white">
      <DashboardSidebar />
      <main className="ml-[96px] min-h-dvh py-8 pr-8 pb-12 max-[780px]:py-5 max-[780px]:pr-4 max-[560px]:ml-[84px] max-[560px]:px-3">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs text-[#5b5b5b]">Growth / Marketing</p>
            <h1 className="mt-3 font-[var(--font-bricolage)] text-[clamp(32px,3.2vw,44px)] font-medium tracking-[-0.035em]">
              Marketing
            </h1>
            <p className="mt-2 text-sm text-[#b4b4b4]">
              Capture demand, stitch every touchpoint and close the loop with ad
              platforms.
            </p>
          </div>
          <div className="flex flex-wrap items-end justify-end gap-2">
            <div>
              <span className="mb-2 block text-[11px] font-medium text-[#777]">
                Project
              </span>
              <SelectControl
                aria-label="Filter by project"
                className="w-64 max-[560px]:w-full"
                value={project}
                onChange={(event) => setProject(event.target.value)}
              >
                <option value="">All accessible projects</option>
                {overview?.projects.map((item) => (
                  <option
                    key={String(item.project_id)}
                    value={String(item.project_id)}
                  >
                    {String(item.project_name)}
                  </option>
                ))}
              </SelectControl>
            </div>
            <div>
              <span className="mb-2 block text-[11px] font-medium text-[#777]">
                Reporting period
              </span>
              <SelectControl
                aria-label="Reporting period"
                className="w-36"
                value={days}
                onChange={(event) => setDays(event.target.value)}
              >
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
                <option value="365">1 year</option>
              </SelectControl>
            </div>
            <button
              aria-label="Refresh marketing data"
              title="Refresh"
              className="flex size-11 items-center justify-center rounded-[10px] border border-[#363636] bg-[#191919] text-[#999] transition hover:bg-[#262626] hover:text-white"
              onClick={() => void load()}
            >
              <RefreshCw
                className={`size-4 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </header>

        <section className="mt-7 overflow-hidden rounded-2xl border border-[#2c2c2c] bg-[#080808]">
          <header className="border-b border-[#2c2c2c] bg-[#191919] px-4 py-3 text-sm font-medium text-[#dedede]">
            Overview
          </header>
          <div className="grid grid-cols-4 max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
            <Metric
              label="Visitors"
              value={asNumber(summary.visitors).toLocaleString("en-IN")}
              detail={`${days}-day reach`}
            />
            <Metric
              label="Touchpoints"
              value={asNumber(summary.touchpoints).toLocaleString("en-IN")}
              detail={`${asNumber(summary.submissions)} submissions`}
            />
            <Metric
              label="Attributed leads"
              value={asNumber(summary.attributed_leads).toLocaleString("en-IN")}
              detail="CRM records"
            />
            <Metric
              label="Conversion"
              value={`${asNumber(summary.conversion_rate).toFixed(1)}%`}
              detail="Visitor to lead"
            />
          </div>
        </section>

        <nav className="mt-4 flex items-center gap-1 overflow-x-auto rounded-xl border border-[#2c2c2c] bg-[#191919] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((item) => (
            <button
              key={item.key}
              className={`h-10 shrink-0 rounded-lg px-4 text-xs font-medium whitespace-nowrap transition ${tab === item.key ? "bg-[#3b3b3b] text-white" : "text-[#999] hover:bg-[#242424] hover:text-white"}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {error ? (
          <div className="mt-6 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-5 py-4 text-sm text-red-200">
            <strong>Marketing setup is unavailable.</strong>
            <span className="ml-2 text-red-200/70">
              {error}. Apply the 20261005 migration, then refresh.
            </span>
          </div>
        ) : null}
        {loading && !overview ? (
          <div className="flex min-h-[420px] items-center justify-center">
            <LoaderCircle className="size-5 animate-spin text-[#50cdaa]" />
          </div>
        ) : null}

        {!error && overview && tab === "overview" ? (
          <section className="mt-4 grid grid-cols-[minmax(0,1.65fr)_minmax(300px,.65fr)] overflow-hidden rounded-2xl border border-[#2c2c2c] bg-[#080808] max-[1050px]:grid-cols-1">
            <div className="border-r border-[#2c2c2c] p-5 max-[1050px]:border-r-0">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] tracking-[0.18em] text-[#50cdaa] uppercase">
                    Demand momentum
                  </span>
                  <h2 className="mt-1 text-lg font-medium">
                    Touchpoints and lead creation
                  </h2>
                </div>
                <span className="text-[10px] text-[#626a67]">
                  Live attribution data
                </span>
              </div>
              <div className="mt-5 h-[310px]">
                {chartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid
                        stroke="rgba(255,255,255,.06)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#68706d", fontSize: 10 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#68706d", fontSize: 10 }}
                        width={30}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#111614",
                          border: "1px solid rgba(255,255,255,.12)",
                          borderRadius: 10,
                          fontSize: 12,
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="touchpoints"
                        stroke="#3f7868"
                        strokeWidth={1.5}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="leads"
                        stroke="#58dab4"
                        strokeWidth={2.5}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty
                    title="Waiting for the first touchpoint"
                    body="Publish a form or install the tracking script to begin measuring demand."
                  />
                )}
              </div>
            </div>
            <div className="p-5 max-[1050px]:border-t max-[1050px]:border-[#2c2c2c]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] tracking-[0.18em] text-[#77807c] uppercase">
                  Source performance
                </span>
                <span className="text-[10px] text-[#626a67]">
                  Leads / touches
                </span>
              </div>
              <div className="mt-4 space-y-4">
                {overview.sources.length ? (
                  overview.sources.map((source) => {
                    const width = Math.min(
                      100,
                      (asNumber(source.leads) /
                        Math.max(1, asNumber(summary.attributed_leads))) *
                        100,
                    );
                    return (
                      <div key={String(source.source_name)}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="truncate text-[#cbd0cd]">
                            {String(source.source_name)}
                          </span>
                          <span className="text-[#7e8783]">
                            {asNumber(source.leads)} /{" "}
                            {asNumber(source.touchpoints)}
                          </span>
                        </div>
                        <div className="mt-2 h-1 overflow-hidden bg-white/[0.06]">
                          <div
                            className="h-full bg-[#50cdaa]"
                            style={{
                              width: `${Math.max(width, source.leads ? 4 : 0)}%`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-[#68706d]">
                    No attributed sources yet.
                  </p>
                )}
              </div>
              <button
                className="mt-7 flex w-full items-center justify-between border-t border-white/[0.08] pt-4 text-xs text-[#87908c] hover:text-white"
                onClick={() => setTab("forms")}
              >
                <span>Configure acquisition</span>
                <ArrowUpRight className="size-3.5" />
              </button>
            </div>
          </section>
        ) : null}

        {!error && overview && tab === "touchpoints" ? (
          <DataTable
            rows={overview.touchpoints}
            columns={[
              { key: "event_type", label: "Event" },
              {
                key: "contact_name",
                label: "Lead / visitor",
                fallback: "Anonymous visitor",
              },
              { key: "provider", label: "Provider" },
              { key: "utm_campaign", label: "Campaign" },
              { key: "project_name", label: "Project" },
              { key: "occurred_at", label: "Occurred", format: shortDate },
            ]}
            emptyTitle="No touchpoints yet"
            emptyBody="Install the website script or connect a lead provider to begin the attribution timeline."
          />
        ) : null}

        {!error && overview && tab === "forms" ? (
          <section className="mt-4 rounded-2xl border border-[#2c2c2c] bg-[#080808] p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-medium">Capture endpoints</h2>
                <p className="mt-1 text-xs text-[#707875]">
                  One secure mapping per landing page, partner, portal or Google
                  lead form.
                </p>
              </div>
              <button
                className="flex items-center gap-2 rounded-lg bg-[#42b995] px-4 py-2.5 text-xs font-semibold text-[#05100c] hover:bg-[#54cfaa]"
                onClick={() => setFormDialog(true)}
              >
                <Plus className="size-4" /> New endpoint
              </button>
            </div>
            {forms.length ? (
              <div className="mt-5 overflow-hidden rounded-xl border border-[#2c2c2c] bg-[#0b0b0b] divide-y divide-[#2c2c2c]">
                {forms.map((form) => (
                  <div
                    key={String(form.form_id)}
                    className="grid grid-cols-[minmax(200px,1fr)_150px_150px_130px_auto] items-center gap-4 px-4 py-4 transition hover:bg-[#101010] max-[950px]:grid-cols-[1fr_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-[#e6e9e7]">
                          {String(form.form_name)}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${form.is_active ? "bg-[#50cdaa]/10 text-[#50cdaa]" : "bg-white/[0.06] text-[#737b78]"}`}
                        >
                          {form.is_active ? "Live" : "Paused"}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-[#68706d]">
                        {String(form.project_name)} · {String(form.public_key)}
                      </p>
                    </div>
                    <div className="max-[950px]:hidden">
                      <span className="block text-[9px] tracking-wider text-[#616966] uppercase">
                        Provider
                      </span>
                      <span className="mt-1 block text-xs text-[#aab1ae]">
                        {String(form.provider).replaceAll("_", " ")}
                      </span>
                    </div>
                    <div className="max-[950px]:hidden">
                      <span className="block text-[9px] tracking-wider text-[#616966] uppercase">
                        Attribution
                      </span>
                      <span className="mt-1 block truncate text-xs text-[#aab1ae]">
                        {String(form.source_name ?? "Direct")} ·{" "}
                        {String(form.campaign_name ?? "No campaign")}
                      </span>
                    </div>
                    <div className="max-[950px]:hidden">
                      <span className="block text-[9px] tracking-wider text-[#616966] uppercase">
                        Captured
                      </span>
                      <span className="mt-1 block text-xs text-[#aab1ae]">
                        {asNumber(form.lead_count)} leads /{" "}
                        {asNumber(form.touchpoint_count)}
                      </span>
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        title="Copy public key"
                        className="rounded-lg p-2 text-[#77807c] hover:bg-white/[0.06] hover:text-white"
                        onClick={() => {
                          void navigator.clipboard.writeText(
                            String(form.public_key),
                          );
                          toast.success("Public key copied");
                        }}
                      >
                        <Copy className="size-4" />
                      </button>
                      <button
                        title={form.is_active ? "Pause" : "Activate"}
                        className="rounded-lg p-2 text-[#77807c] hover:bg-white/[0.06] hover:text-white"
                        onClick={() =>
                          toast.promise(
                            patchForm(String(form.form_id), {
                              is_active: !form.is_active,
                            }),
                            {
                              loading: "Updating…",
                              success: form.is_active
                                ? "Endpoint paused"
                                : "Endpoint activated",
                              error: (cause) => cause.message,
                            },
                          )
                        }
                      >
                        {form.is_active ? (
                          <X className="size-4" />
                        ) : (
                          <Check className="size-4" />
                        )}
                      </button>
                      <button
                        title="Rotate secret"
                        className="rounded-lg p-2 text-[#77807c] hover:bg-white/[0.06] hover:text-white"
                        onClick={() =>
                          toast.promise(
                            patchForm(
                              String(form.form_id),
                              form.provider === "google_lead_form"
                                ? { rotate_webhook_secret: true }
                                : { rotate_submission_secret: true },
                            ),
                            {
                              loading: "Rotating…",
                              success: "Secret rotated",
                              error: (cause) => cause.message,
                            },
                          )
                        }
                      >
                        <KeyRound className="size-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="No capture endpoints"
                body="Create a website form, Google lead form or partner webhook mapping."
              />
            )}
          </section>
        ) : null}

        {!error && overview && tab === "integrations" ? (
          <section className="mt-4 rounded-2xl border border-[#2c2c2c] bg-[#080808] p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-medium">Connected platforms</h2>
                <p className="mt-1 text-xs text-[#707875]">
                  Send qualified CRM outcomes back to the platform that created
                  demand.
                </p>
              </div>
              <button
                className="flex items-center gap-2 rounded-lg bg-[#42b995] px-4 py-2.5 text-xs font-semibold text-[#05100c] hover:bg-[#54cfaa]"
                onClick={() => setIntegrationDialog(true)}
              >
                <Plus className="size-4" /> Add Google Ads
              </button>
            </div>
            {integrations.length ? (
              <div className="mt-5 grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
                {integrations.map((integration) => (
                  <div
                    key={String(integration.integration_id)}
                    className="rounded-xl border border-[#2c2c2c] bg-[#111] p-5 transition hover:border-[#3b3b3b]"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex gap-3">
                        <div className="flex size-10 items-center justify-center rounded-lg bg-[#50cdaa]/10">
                          <Link2 className="size-4 text-[#50cdaa]" />
                        </div>
                        <div>
                          <h3 className="text-sm font-medium">
                            {String(integration.integration_name)}
                          </h3>
                          <p className="mt-1 text-[11px] text-[#68706d]">
                            Google Ads ·{" "}
                            {String(
                              integration.external_account_id ??
                                "Account not set",
                            )}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`rounded px-2 py-1 text-[9px] font-semibold uppercase ${integration.status === "connected" ? "bg-[#50cdaa]/10 text-[#50cdaa]" : integration.status === "error" ? "bg-red-400/10 text-red-300" : "bg-amber-400/10 text-amber-300"}`}
                      >
                        {String(integration.status)}
                      </span>
                    </div>
                    {integration.last_error ? (
                      <p className="mt-4 rounded-lg bg-red-400/[0.06] px-3 py-2 text-[11px] text-red-200/80">
                        {String(integration.last_error)}
                      </p>
                    ) : null}
                    <div className="mt-5 flex items-center justify-between border-t border-white/[0.07] pt-4">
                      <span className="text-[10px] text-[#68706d]">
                        {integration.last_synced_at
                          ? `Last delivery ${shortDate(integration.last_synced_at)}`
                          : "No conversions delivered yet"}
                      </span>
                      <a
                        className="rounded-lg border border-white/[0.1] px-3 py-2 text-[11px] text-[#c2c8c5] no-underline hover:border-[#50cdaa]/40 hover:text-white"
                        href={`/api/marketing/integrations/${integration.integration_id}/google/start`}
                      >
                        {integration.status === "connected"
                          ? "Reconnect"
                          : "Connect Google"}
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="No ad platform connected"
                body="Add Google Ads, authorize Data Manager and map the CRM milestones you want to optimize for."
              />
            )}
          </section>
        ) : null}

        {!error && overview && tab === "conversions" ? (
          <DataTable
            rows={overview.conversions}
            columns={[
              { key: "event_name", label: "CRM event" },
              { key: "integration_name", label: "Destination" },
              { key: "project_name", label: "Project" },
              { key: "status", label: "Status" },
              { key: "created_at", label: "Queued", format: shortDate },
              { key: "last_error", label: "Diagnostic", fallback: "—" },
            ]}
            emptyTitle="No conversion events queued"
            emptyBody="Qualify a tracked lead, complete its site visit or confirm its booking to create the first event."
            action={(row) =>
              row.status === "failed" ? (
                <button
                  className="rounded-lg p-2 text-[#7d8682] hover:bg-white/[0.06] hover:text-white"
                  title="Retry"
                  onClick={() =>
                    void retryConversion(String(row.conversion_job_id))
                  }
                >
                  <RotateCcw className="size-4" />
                </button>
              ) : null
            }
          />
        ) : null}
      </main>

      {formDialog && overview ? (
        <FormDialog
          overview={overview}
          integrations={integrations}
          onClose={() => setFormDialog(false)}
          onCreated={(body) => {
            setFormDialog(false);
            setCredentials({
              ...((body.credentials as RecordValue) ?? {}),
              form: body.form,
            });
            void load();
          }}
        />
      ) : null}
      {integrationDialog ? (
        <IntegrationDialog
          onClose={() => setIntegrationDialog(false)}
          onCreated={() => {
            setIntegrationDialog(false);
            void load();
          }}
        />
      ) : null}
      {credentials ? (
        <CredentialsDialog
          credentials={credentials}
          onClose={() => setCredentials(null)}
        />
      ) : null}
    </div>
  );
}

function DataTable({
  rows,
  columns,
  emptyTitle,
  emptyBody,
  action,
}: {
  rows: RecordValue[];
  columns: Array<{
    key: string;
    label: string;
    fallback?: string;
    format?: (value: unknown) => string;
  }>;
  emptyTitle: string;
  emptyBody: string;
  action?: (row: RecordValue) => React.ReactNode;
}) {
  if (!rows.length)
    return (
      <div className="mt-4 rounded-2xl border border-[#2c2c2c] bg-[#080808]">
        <Empty title={emptyTitle} body={emptyBody} />
      </div>
    );
  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-[#2c2c2c] bg-[#080808]">
      <table className="w-full min-w-[880px] border-collapse text-left">
        <thead className="bg-[#191919]">
          <tr className="border-b border-[#2c2c2c]">
            {columns.map((column) => (
              <th
                key={column.key}
                className="h-10 px-4 text-[10px] font-semibold tracking-[0.1em] text-[#777] uppercase"
              >
                {column.label}
              </th>
            ))}
            {action ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={String(row.touchpoint_id ?? row.conversion_job_id ?? index)}
              className="h-[64px] border-b border-[#2c2c2c] transition last:border-b-0 hover:bg-[#101010]"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className="max-w-64 truncate px-4 py-3.5 text-xs text-[#aeb5b2]"
                >
                  {column.format
                    ? column.format(row[column.key])
                    : String(
                        row[column.key] ?? column.fallback ?? "—",
                      ).replaceAll("_", " ")}
                </td>
              ))}
              {action ? (
                <td className="w-10 text-right">{action(row)}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormDialog({
  overview,
  integrations,
  onClose,
  onCreated,
}: {
  overview: Overview;
  integrations: RecordValue[];
  onClose: () => void;
  onCreated: (body: RecordValue) => void;
}) {
  const [provider, setProvider] = useState("website_form");
  const [name, setName] = useState("");
  const [project, setProject] = useState(
    String(overview.projects[0]?.project_id ?? ""),
  );
  const [source, setSource] = useState("");
  const [campaign, setCampaign] = useState("");
  const [integration, setIntegration] = useState("");
  const [origins, setOrigins] = useState("");
  const [providerFormId, setProviderFormId] = useState("");
  const [saving, setSaving] = useState(false);
  const campaigns = overview.campaigns.filter(
    (item) => !source || String(item.source_id ?? "") === source,
  );
  async function save() {
    const endpointName = name.trim();
    const allowedOrigins = origins
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!endpointName) {
      toast.error("Enter an endpoint name");
      return;
    }
    if (!project) {
      toast.error("Select a project");
      return;
    }
    if (provider === "website_form" && allowedOrigins.length === 0) {
      toast.error("Add at least one allowed website origin");
      return;
    }
    if (provider === "google_lead_form" && !providerFormId.trim()) {
      toast.error("Enter the Google form ID");
      return;
    }
    setSaving(true);
    try {
      const response = await fetchWithSession("/api/marketing/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form_name: endpointName,
          provider,
          project_id: Number(project),
          source_id: source || null,
          campaign_id: campaign || null,
          integration_id: integration || null,
          provider_form_id: providerFormId || null,
          allowed_origins: provider === "website_form" ? allowedOrigins : [],
          lead_defaults: {},
          field_mapping: {},
        }),
      });
      const body = (await response.json()) as RecordValue;
      if (!response.ok) {
        const details = Array.isArray(body.details)
          ? body.details.map(String).filter(Boolean)
          : [];
        throw new Error(
          details.length
            ? details.join(". ")
            : String(body.error ?? "Unable to create endpoint"),
        );
      }
      toast.success("Capture endpoint created");
      onCreated(body);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to create endpoint",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      title="New capture endpoint"
      subtitle="Map a public acquisition surface to one CRM project and attribution source."
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-4 p-6 max-[620px]:grid-cols-1">
        <label>
          <span className={labelClass}>Endpoint name</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Skyline Heights landing page"
            required
          />
        </label>
        <label>
          <span className={labelClass}>Provider</span>
          <SelectControl
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="website_form">Website form</option>
            <option value="google_lead_form">Google lead form</option>
            <option value="generic_webhook">Generic webhook</option>
            <option value="channel_partner">Channel partner</option>
            <option value="property_portal">Property portal</option>
          </SelectControl>
        </label>
        <label>
          <span className={labelClass}>Project</span>
          <SelectControl
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            {overview.projects.map((item) => (
              <option
                key={String(item.project_id)}
                value={String(item.project_id)}
              >
                {String(item.project_name)}
              </option>
            ))}
          </SelectControl>
        </label>
        <label>
          <span className={labelClass}>Lead source</span>
          <SelectControl
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setCampaign("");
            }}
          >
            <option value="">Direct / unassigned</option>
            {overview.lead_sources.map((item) => (
              <option
                key={String(item.source_id)}
                value={String(item.source_id)}
              >
                {String(item.source_name)}
              </option>
            ))}
          </SelectControl>
        </label>
        <label>
          <span className={labelClass}>Campaign</span>
          <SelectControl
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
          >
            <option value="">No campaign</option>
            {campaigns.map((item) => (
              <option
                key={String(item.campaign_id)}
                value={String(item.campaign_id)}
              >
                {String(item.campaign_name)}
              </option>
            ))}
          </SelectControl>
        </label>
        <label>
          <span className={labelClass}>Related integration</span>
          <SelectControl
            value={integration}
            onChange={(e) => setIntegration(e.target.value)}
          >
            <option value="">None</option>
            {integrations.map((item) => (
              <option
                key={String(item.integration_id)}
                value={String(item.integration_id)}
              >
                {String(item.integration_name)}
              </option>
            ))}
          </SelectControl>
        </label>
        {provider === "google_lead_form" ? (
          <label className="col-span-2 max-[620px]:col-span-1">
            <span className={labelClass}>Google form ID</span>
            <input
              className={inputClass}
              value={providerFormId}
              onChange={(e) => setProviderFormId(e.target.value)}
              placeholder="Google lead form asset ID"
            />
          </label>
        ) : provider === "website_form" ? (
          <label className="col-span-2 max-[620px]:col-span-1">
            <span className={labelClass}>
              Allowed website origins — one per line
            </span>
            <textarea
              className={`${inputClass} h-24 py-3`}
              value={origins}
              onChange={(e) => setOrigins(e.target.value)}
              placeholder={
                "https://www.example.com\nhttps://campaign.example.com"
              }
            />
          </label>
        ) : (
          <div className="col-span-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-4 py-3 text-xs leading-5 text-[#8b9490] max-[620px]:col-span-1">
            Allowed website origins are not required for server push. After
            creating the endpoint, authenticate requests with the one-time
            submission secret.
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-white/[0.08] px-6 py-4">
        <button
          className="rounded-lg px-4 py-2.5 text-xs text-[#8b9490] hover:text-white"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-[#48c39f] px-4 py-2.5 text-xs font-semibold text-[#06100d] disabled:opacity-50"
          onClick={() => void save()}
        >
          {saving ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}{" "}
          Create endpoint
        </button>
      </div>
    </Dialog>
  );
}

function IntegrationDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("Google Ads conversions");
  const [account, setAccount] = useState("");
  const [login, setLogin] = useState("");
  const [qualified, setQualified] = useState("");
  const [visit, setVisit] = useState("");
  const [booking, setBooking] = useState("");
  const [won, setWon] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      const response = await fetchWithSession("/api/marketing/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "google_data_manager",
          integration_name: name,
          external_account_id: account,
          login_account_id: login || account,
          settings: {
            conversion_actions: {
              lead_qualified: qualified,
              site_visit_completed: visit,
              booking_confirmed: booking,
              opportunity_won: won,
            },
          },
        }),
      });
      const body = (await response.json()) as RecordValue;
      if (!response.ok)
        throw new Error(String(body.error ?? "Unable to create integration"));
      toast.success("Google integration created");
      onCreated();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to create integration",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      title="Add Google Ads"
      subtitle="Map CRM milestones to Google conversion action IDs, then authorize Data Manager."
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-4 p-6 max-[620px]:grid-cols-1">
        <label className="col-span-2 max-[620px]:col-span-1">
          <span className={labelClass}>Integration name</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <span className={labelClass}>Operating account ID</span>
          <input
            className={inputClass}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="123-456-7890"
          />
        </label>
        <label>
          <span className={labelClass}>Login / manager account ID</span>
          <input
            className={inputClass}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="Optional"
          />
        </label>
        <div className="col-span-2 mt-2 flex items-center gap-2 border-t border-white/[0.08] pt-5 text-[10px] font-semibold tracking-[0.16em] text-[#6e7773] uppercase max-[620px]:col-span-1">
          <Settings2 className="size-3.5" /> Conversion action IDs
        </div>
        <label>
          <span className={labelClass}>Lead qualified</span>
          <input
            className={inputClass}
            value={qualified}
            onChange={(e) => setQualified(e.target.value)}
            placeholder="Numeric action ID"
          />
        </label>
        <label>
          <span className={labelClass}>Site visit completed</span>
          <input
            className={inputClass}
            value={visit}
            onChange={(e) => setVisit(e.target.value)}
            placeholder="Numeric action ID"
          />
        </label>
        <label>
          <span className={labelClass}>Booking confirmed</span>
          <input
            className={inputClass}
            value={booking}
            onChange={(e) => setBooking(e.target.value)}
            placeholder="Numeric action ID"
          />
        </label>
        <label>
          <span className={labelClass}>Opportunity won</span>
          <input
            className={inputClass}
            value={won}
            onChange={(e) => setWon(e.target.value)}
            placeholder="Numeric action ID"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-white/[0.08] px-6 py-4">
        <button
          className="rounded-lg px-4 py-2.5 text-xs text-[#8b9490] hover:text-white"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-[#48c39f] px-4 py-2.5 text-xs font-semibold text-[#06100d] disabled:opacity-50"
          onClick={() => void save()}
        >
          {saving ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Link2 className="size-4" />
          )}{" "}
          Save integration
        </button>
      </div>
    </Dialog>
  );
}

function CredentialsDialog({
  credentials,
  onClose,
}: {
  credentials: RecordValue;
  onClose: () => void;
}) {
  const form = credentials.form as RecordValue | undefined;
  const publicKey = String(form?.public_key ?? "");
  const isGoogle = form?.provider === "google_lead_form";
  const endpoint =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/api/marketing/${isGoogle ? `webhooks/google/${publicKey}` : `forms/${publicKey}/submit`}`;
  const secret = String(
    isGoogle
      ? (credentials.google_key ?? "")
      : (credentials.submission_secret ?? ""),
  );
  return (
    <Dialog
      title="Save the endpoint credentials"
      subtitle="The secret is shown only once. Store it in the external platform’s secret manager."
      onClose={onClose}
    >
      <div className="space-y-4 p-6">
        <div>
          <span className={labelClass}>Endpoint URL</span>
          <div className="flex rounded-lg border border-white/[0.1] bg-[#080b0a]">
            <code className="min-w-0 flex-1 overflow-x-auto px-3 py-3 text-xs text-[#b8c0bd]">
              {endpoint}
            </code>
            <button
              className="px-3 text-[#77807c] hover:text-white"
              onClick={() => {
                void navigator.clipboard.writeText(endpoint);
                toast.success("Endpoint copied");
              }}
            >
              <Copy className="size-4" />
            </button>
          </div>
        </div>
        <div>
          <span className={labelClass}>
            {isGoogle ? "Google key" : "Server submission secret"}
          </span>
          <div className="flex rounded-lg border border-amber-300/20 bg-amber-300/[0.04]">
            <code className="min-w-0 flex-1 overflow-x-auto px-3 py-3 text-xs text-amber-100">
              {secret}
            </code>
            <button
              className="px-3 text-amber-200/60 hover:text-amber-100"
              onClick={() => {
                void navigator.clipboard.writeText(secret);
                toast.success("Secret copied");
              }}
            >
              <Copy className="size-4" />
            </button>
          </div>
        </div>
        {!isGoogle ? (
          <div>
            <span className={labelClass}>Landing-page script</span>
            <div className="rounded-lg border border-white/[0.1] bg-[#080b0a] p-3">
              <code className="text-[11px] leading-5 text-[#95a09b]">{`<script src="${window.location.origin}/sthyra-marketing.js" data-form-key="${publicKey}" defer></script>`}</code>
            </div>
            <p className="mt-2 text-[11px] text-[#69716e]">
              Add <code className="text-[#9da5a1]">data-sthyra-form</code> to
              the landing-page form, or call{" "}
              <code className="text-[#9da5a1]">
                SthyraMarketing.submit(fields)
              </code>
              .
            </p>
          </div>
        ) : null}
      </div>
      <div className="flex justify-end border-t border-white/[0.08] px-6 py-4">
        <button
          className="rounded-lg bg-[#48c39f] px-5 py-2.5 text-xs font-semibold text-[#06100d]"
          onClick={onClose}
        >
          I saved these
        </button>
      </div>
    </Dialog>
  );
}
