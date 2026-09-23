"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { fetchWithSession } from "@/lib/clientAuth";
import { DEFAULT_PROJECT_LEAD_STAGES } from "@/lib/defaultLeadStages";

type Lead = {
  lead_id: string;
  project_id?: number;
  project_code?: string;
  project_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
  status?: string;
  temperature?: string | null;
  current_owner_user_id?: string | null;
  current_team_id?: string | null;
  source_id?: string | null;
  campaign_id?: string | null;
  sub_source?: string | null;
  stage_name?: string | null;
  updated_at?: string;
};

type ProjectSummary = {
  project_id: number;
  project_code: string;
  project_name: string;
  project_status: string;
  project_type: string;
};

type ProjectContextResponse = {
  company?: {
    company_id: number;
    company_code: string;
    company_name: string;
  };
  role_key?: string;
  can_view_all_projects?: boolean;
  projects?: ProjectSummary[];
  error?: string;
};

type LeadStage = {
  stage_id?: string;
  stage_key: string;
  stage_name: string;
  position: number;
  is_initial: boolean;
  is_terminal: boolean;
};

type LeadDetail = Lead & {
  project_id?: number;
  budget?: string | number | null;
  buying_reason?: string | null;
  preferred_location?: string | null;
  preferred_config?: string | null;
  preferred_floor?: string | null;
  contact?: {
    first_name?: string;
    last_name?: string | null;
    email?: string | null;
    phone_number?: string | null;
    company_works_at?: string | null;
    address?: string | null;
  };
  stage?: { stage_name?: string | null } | null;
};

type TimelineEvent = {
  event_id: string;
  event_type: string;
  data?: Record<string, unknown>;
  occurred_at: string;
};

type LeadResponse = {
  leads: Lead[];
  summary?: {
    total: number;
    qualified: number;
    hot: number;
    needsFollowUp: number;
    unassigned: number;
  };
  pagination?: { page: number; total?: number; totalPages?: number };
};

const leadStatuses = [
  "all",
  "active",
  "qualified",
  "nurture",
  "closed",
  "duplicate",
  "invalid",
];

const defaultPipelineStages: LeadStage[] = DEFAULT_PROJECT_LEAD_STAGES.map(
  (item, index) => ({
    ...item,
    position: index + 1,
  }),
);

const sortOptions = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "recently_updated", label: "Recently updated" },
  { value: "name_asc", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
  { value: "budget_high", label: "Budget: high to low" },
  { value: "budget_low", label: "Budget: low to high" },
];

const leadActions = [
  { value: "change-stage", label: "Change stage" },
  { value: "qualify", label: "Qualify" },
  { value: "reopen", label: "Reopen" },
  { value: "mark-duplicate", label: "Mark duplicate" },
  { value: "mark-invalid", label: "Mark invalid" },
  { value: "move-to-nurture", label: "Move to nurture" },
];

function label(value?: string | null) {
  return value
    ? value
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "—";
}

function LeadStatus({ lead }: { lead: Lead }) {
  const value = lead.temperature || lead.stage_name || lead.status || "active";
  const dot =
    value.toLowerCase() === "hot"
      ? "bg-[#f0a3a3]"
      : value.toLowerCase() === "warm"
        ? "bg-[#f5c46e]"
        : value.toLowerCase() === "qualified"
          ? "bg-[#65c9a7]"
          : "bg-[#8a8d93]";
  return (
    <span className="inline-flex items-center gap-[7px]">
      <i className={`size-1.5 rounded-full ${dot}`} />
      {label(value)}
    </span>
  );
}

function formatBudget(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-IN", {
        currency: "INR",
        maximumFractionDigits: 0,
        style: "currency",
      }).format(amount)
    : String(value);
}

function timelineTitle(event: TimelineEvent) {
  if (event.event_type === "state_change") {
    return `${label(String(event.data?.command || "Lead updated"))}`;
  }
  if (event.event_type === "ownership_change") return "Ownership updated";
  if (event.event_type === "attribution_added") return "Attribution added";
  if (event.event_type.startsWith("tag_")) return "Lead tags updated";
  if (event.event_type === "next_action_updated") return "Next action updated";
  return label(event.event_type);
}

function timelineDescription(event: TimelineEvent) {
  const metadata = event.data?.metadata;
  if (metadata && typeof metadata === "object") {
    return Object.entries(metadata)
      .map(([key, value]) => `${label(key)}: ${String(value)}`)
      .join(" · ");
  }
  if (event.event_type === "state_change") {
    const from = event.data?.from_status;
    const to = event.data?.to_status;
    if (from || to)
      return `${label(String(from || "New"))} → ${label(String(to || "—"))}`;
  }
  return "Lead activity recorded in the CRM.";
}

export default function LeadsPage() {
  const router = useRouter();
  const [projectContext, setProjectContext] =
    useState<ProjectContextResponse | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [projectContextLoading, setProjectContextLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [status, setStatus] = useState("all");
  const [pipelineStages, setPipelineStages] = useState<LeadStage[]>([]);
  const [temperature, setTemperature] = useState("all");
  const [assignment, setAssignment] = useState("all");
  const [sort, setSort] = useState("newest");
  const [openTool, setOpenTool] = useState<"filter" | "sort" | null>(null);
  const leadToolsRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LeadResponse>({ leads: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLead, setActionLead] = useState<string | null>(null);
  const [actionMenuLead, setActionMenuLead] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadDetail, setLeadDetail] = useState<LeadDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<
    "activity" | "calls" | "email" | "notes"
  >("activity");

  useEffect(() => {
    let cancelled = false;

    async function loadProjectContext() {
      try {
        const response = await fetchWithSession("/api/auth/project-context", {
          cache: "no-store",
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        const body = (await response.json()) as ProjectContextResponse;
        if (!response.ok) {
          throw new Error(body.error || "Unable to retrieve projects");
        }
        if (cancelled) return;

        const projects = body.projects ?? [];
        const requestedProject = new URLSearchParams(
          window.location.search,
        ).get("project_id");
        const requestedProjectExists = projects.some(
          (project) => String(project.project_id) === requestedProject,
        );
        const initialProject =
          requestedProject === "all" && body.can_view_all_projects
            ? "all"
            : requestedProjectExists
              ? requestedProject
              : body.can_view_all_projects
                ? "all"
                : projects[0]
                  ? String(projects[0].project_id)
                  : null;

        setProjectContext(body);
        setSelectedProjectId(initialProject);
        if (!initialProject) {
          setError("No active projects are available for your account.");
          setLoading(false);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to retrieve projects",
          );
          setLoading(false);
        }
      } finally {
        if (!cancelled) setProjectContextLoading(false);
      }
    }

    void loadProjectContext();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!selectedProjectId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("project_id", selectedProjectId);
    window.history.replaceState(null, "", url);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    if (selectedProjectId === "all") return;

    let cancelled = false;
    async function loadPipelineStages() {
      try {
        const response = await fetchWithSession(
          `/api/projects/${selectedProjectId}/lead-stages`,
          { cache: "no-store" },
        );
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        const body = (await response.json()) as {
          stages?: LeadStage[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error || "Unable to retrieve lead stages");
        }
        if (!cancelled) setPipelineStages(body.stages ?? []);
      } catch (cause) {
        if (!cancelled) {
          toast.error(
            cause instanceof Error
              ? cause.message
              : "Unable to retrieve lead stages",
          );
        }
      }
    }

    void loadPipelineStages();
    return () => {
      cancelled = true;
    };
  }, [router, selectedProjectId]);

  const loadLeads = useCallback(async () => {
    if (!selectedProjectId) return;
    await Promise.resolve();
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "10" });
    params.set("project_id", selectedProjectId);
    if (search.trim()) params.set("search", search.trim());
    if (stage !== "all") params.set("stage_key", stage);
    if (status !== "all") params.set("status", status);
    if (temperature !== "all") params.set("temperature", temperature);
    if (assignment !== "all") params.set("assignment", assignment);
    params.set("sort", sort);
    try {
      const response = await fetchWithSession(
        `/api/leads?${params.toString()}`,
        {
          cache: "no-store",
        },
      );
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      const body = (await response.json()) as LeadResponse & { error?: string };
      if (!response.ok)
        throw new Error(body.error || "Unable to retrieve leads");
      setData(body);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to retrieve leads",
      );
    } finally {
      setLoading(false);
    }
  }, [
    assignment,
    page,
    router,
    search,
    selectedProjectId,
    sort,
    stage,
    status,
    temperature,
  ]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadLeads(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadLeads]);

  useEffect(() => {
    if (!openTool) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!leadToolsRef.current?.contains(event.target as Node)) {
        setOpenTool(null);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenTool(null);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openTool]);

  useEffect(() => {
    if (!actionMenuLead) return;

    function closeActionMenu(event: PointerEvent) {
      if (!(event.target as Element).closest("[data-lead-row-actions]")) {
        setActionMenuLead(null);
      }
    }

    function closeActionMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setActionMenuLead(null);
    }

    document.addEventListener("pointerdown", closeActionMenu);
    document.addEventListener("keydown", closeActionMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeActionMenu);
      document.removeEventListener("keydown", closeActionMenuOnEscape);
    };
  }, [actionMenuLead]);

  const selectedLeadId = selectedLead?.lead_id ?? null;

  useEffect(() => {
    if (!selectedLeadId) return;

    function closeDrawerOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedLead(null);
    }

    document.addEventListener("keydown", closeDrawerOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeDrawerOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedLeadId]);

  useEffect(() => {
    if (!selectedLeadId) return;

    let cancelled = false;

    async function loadLeadOverview() {
      await Promise.resolve();
      if (cancelled) return;
      setDrawerLoading(true);
      setDrawerError(null);
      setLeadDetail(null);
      setTimeline([]);
      setDrawerTab("activity");

      try {
        const [leadResponse, timelineResponse] = await Promise.all([
          fetchWithSession(`/api/leads/${selectedLeadId}`, {
            cache: "no-store",
          }),
          fetchWithSession(`/api/leads/${selectedLeadId}/timeline?limit=20`, {
            cache: "no-store",
          }),
        ]);
        if (leadResponse.status === 401 || timelineResponse.status === 401) {
          router.replace("/login");
          return;
        }
        const leadBody = (await leadResponse.json()) as {
          lead?: LeadDetail;
          error?: string;
        };
        const timelineBody = (await timelineResponse.json()) as {
          events?: TimelineEvent[];
          error?: string;
        };
        if (!leadResponse.ok) {
          throw new Error(leadBody.error || "Unable to retrieve lead");
        }
        if (!timelineResponse.ok) {
          throw new Error(
            timelineBody.error || "Unable to retrieve lead activity",
          );
        }
        if (!cancelled) {
          setLeadDetail(leadBody.lead ?? null);
          setTimeline(timelineBody.events ?? []);
        }
      } catch (cause) {
        if (!cancelled) {
          setDrawerError(
            cause instanceof Error
              ? cause.message
              : "Unable to retrieve lead overview",
          );
        }
      } finally {
        if (!cancelled) setDrawerLoading(false);
      }
    }

    void loadLeadOverview();
    return () => {
      cancelled = true;
    };
  }, [router, selectedLeadId]);

  async function runLeadAction(leadId: string, action: string) {
    let body: Record<string, unknown> = {};
    if (action === "change-stage") {
      const stageKey = window.prompt("Enter the project stage key");
      if (!stageKey) return;
      body = { stage_key: stageKey };
    } else if (action === "mark-duplicate") {
      const duplicateId = window.prompt("Enter the duplicate lead UUID");
      if (!duplicateId) return;
      body = { duplicate_of_lead_id: duplicateId };
    } else if (action === "mark-invalid" || action === "move-to-nurture") {
      const reason = window.prompt("Add a reason for this action");
      if (!reason) return;
      body = { reason };
    } else if (action === "qualify") {
      body = { qualification_data: {} };
    }
    setActionLead(leadId);
    try {
      const response = await fetchWithSession(
        `/api/leads/${leadId}/${action}`,
        {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      const responseBody = (await response.json()) as {
        error?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          responseBody.error || responseBody.message || "Lead action failed",
        );
      toast.success(responseBody.message || "Lead updated");
      await loadLeads();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Lead action failed",
      );
    } finally {
      setActionLead(null);
      setActionMenuLead(null);
    }
  }

  function openLeadOverview(lead: Lead) {
    setOpenTool(null);
    setActionMenuLead(null);
    setSelectedLead(lead);
  }

  const total =
    data.summary?.total ?? data.pagination?.total ?? data.leads.length;
  const qualified =
    data.summary?.qualified ??
    data.leads.filter((lead) => lead.status === "qualified").length;
  const hot =
    data.summary?.hot ??
    data.leads.filter((lead) => lead.temperature === "hot").length;
  const activeFilterCount =
    Number(status !== "all") +
    Number(temperature !== "all") +
    Number(assignment !== "all");
  const projects = projectContext?.projects ?? [];
  const selectedProject = projects.find(
    (project) => String(project.project_id) === selectedProjectId,
  );
  const showProjectColumn = selectedProjectId === "all";
  const tableColumnCount = showProjectColumn ? 9 : 8;
  const visiblePipelineStages =
    selectedProjectId === "all" ? defaultPipelineStages : pipelineStages;

  return (
    <main className="min-h-dvh bg-black text-[#f5f5f5]">
      <DashboardSidebar />
      <section className="ml-[100px] min-h-dvh py-8 pr-8 pb-12 transition-[margin] duration-200 peer-hover:ml-[250px] max-[900px]:ml-[250px] max-[900px]:py-6 max-[900px]:pr-5 max-[900px]:pb-10 max-[560px]:ml-0 max-[560px]:px-3 max-[560px]:pt-24 max-[560px]:pb-8">
        <div className="flex items-end justify-between gap-6 max-[900px]:items-stretch max-[900px]:flex-col">
          <div>
            <span className="text-xs text-[#5b5b5b]">
              {projectContext?.company?.company_name || "Workspace"} / Leads
            </span>
            <h1 className="mt-3 font-[var(--font-bricolage)] text-[clamp(32px,3vw,44px)] leading-[1.1]">
              Leads
            </h1>
            <p className="mt-2 text-sm text-[#b4b4b4]">
              Every relationship. One clear next step.
            </p>
          </div>
          <label className="flex basis-60 flex-col gap-[7px] max-[900px]:max-w-80 max-[900px]:basis-auto max-[560px]:w-full max-[560px]:max-w-none">
            <span className="text-[10px] text-[#8a8d93]">Project</span>
            <span className="relative block">
              <select
                className="h-[42px] w-full cursor-pointer appearance-none rounded-[10px] border border-[#363636] bg-[#151515] pr-10 pl-[13px] text-xs text-[#f5f5f5] outline-none focus-visible:border-[#65c9a7] focus-visible:ring-2 focus-visible:ring-[#65c9a7]/15 disabled:cursor-default disabled:opacity-55"
                aria-label="Filter leads by project"
                disabled={projectContextLoading || projects.length === 0}
                onChange={(event) => {
                  setSelectedProjectId(event.target.value);
                  setStage("all");
                  setPage(1);
                  setSelectedLead(null);
                }}
                value={selectedProjectId ?? ""}
              >
                {projectContext?.can_view_all_projects && (
                  <option value="all">All projects</option>
                )}
                {projects.map((project) => (
                  <option
                    key={project.project_id}
                    value={String(project.project_id)}
                  >
                    {project.project_name} · {project.project_code}
                  </option>
                ))}
                {!projectContextLoading && projects.length === 0 && (
                  <option value="">No projects available</option>
                )}
              </select>
              <i
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-4 size-2 -translate-y-[65%] rotate-45 border-r-[1.7px] border-b-[1.7px] border-[#d6d6d6]"
              />
            </span>
          </label>
        </div>
        <section className="mt-7 overflow-hidden rounded-2xl border border-[#2c2c2c] bg-[#080808]">
          <header className="border-b border-[#2c2c2c] bg-[#191919] p-3 font-[var(--font-bricolage)] text-sm">
            Overview
          </header>
          <div className="grid grid-cols-5 px-4 pt-[18px] pb-[22px] max-[900px]:grid-cols-2 max-[900px]:gap-y-[18px] [&>div]:flex [&>div]:flex-col [&>div]:gap-2 [&>div]:border-r [&>div]:border-[#2c2c2c] [&>div]:px-5 [&>div:first-child]:pl-0 [&>div:last-child]:border-r-0 [&>div:nth-child(2)]:max-[900px]:border-r-0 [&>div:nth-child(4)]:max-[900px]:border-r-0 [&_small]:text-[11px] [&_small]:text-[#b4b4b4] [&_span]:text-[11px] [&_span]:text-[#b4b4b4] [&_strong]:text-[30px] [&_strong]:leading-none">
            <div>
              <span>Total leads</span>
              <strong>{total}</strong>
              <small>All active relationships</small>
            </div>
            <div>
              <span>Qualified</span>
              <strong>{qualified}</strong>
              <small>Ready for next action</small>
            </div>
            <div>
              <span>Hot leads</span>
              <strong>{hot}</strong>
              <small>High intent prospects</small>
            </div>
            <div>
              <span>Needs follow-up</span>
              <strong>{data.summary?.needsFollowUp ?? "—"}</strong>
              <small>Next action due soon</small>
            </div>
            <div>
              <span>Unassigned</span>
              <strong>{data.summary?.unassigned ?? "—"}</strong>
              <small>Available in queue</small>
            </div>
          </div>
        </section>
        <div className="relative my-4 flex min-w-0 items-center gap-2">
          <label className="group flex h-11 flex-[1_1_320px] items-center gap-2.5 rounded-[10px] border border-[#2c2c2c] bg-[#111] px-3.5 text-[#8a8d93] max-[1550px]:flex-[0_0_44px] max-[1550px]:cursor-text max-[1550px]:justify-center max-[1550px]:overflow-hidden max-[1550px]:px-0 max-[1550px]:transition-all max-[1550px]:focus-within:flex-[0_0_260px] max-[1550px]:focus-within:justify-start max-[1550px]:focus-within:px-3.5 max-[1550px]:has-[input:not(:placeholder-shown)]:flex-[0_0_260px] max-[1550px]:has-[input:not(:placeholder-shown)]:justify-start max-[1550px]:has-[input:not(:placeholder-shown)]:px-3.5 max-[560px]:focus-within:flex-[0_0_calc(100%-96px)] max-[560px]:has-[input:not(:placeholder-shown)]:flex-[0_0_calc(100%-96px)]">
            <span
              aria-hidden="true"
              className="flex size-4 shrink-0 items-center justify-center"
            >
              <svg
                className="size-4 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]"
                viewBox="0 0 24 24"
              >
                <circle cx="11" cy="11" r="6" />
                <path d="m16 16 4 4" />
              </svg>
            </span>
            <input
              className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[#f5f5f5] outline-none max-[1550px]:w-0 max-[1550px]:flex-none max-[1550px]:opacity-0 max-[1550px]:transition-all max-[1550px]:group-focus-within:flex-1 max-[1550px]:group-focus-within:opacity-100"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search leads by name, email or phone"
              value={search}
            />
          </label>
          <div className="flex w-max min-w-0 flex-[0_1_auto] overflow-x-auto rounded-[10px] border border-[#2c2c2c] bg-[#191919] p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[
              { stage_key: "all", stage_name: "All" },
              ...visiblePipelineStages,
            ].map((item) => (
              <button
                className={`h-9 shrink-0 rounded-[7px] border-0 px-3.5 text-xs whitespace-nowrap transition max-[1550px]:px-[11px] ${stage === item.stage_key ? "bg-[#3b3b3b] text-[#f5f5f5]" : "bg-transparent text-[#b4b4b4]"}`}
                key={item.stage_key}
                onClick={() => {
                  setStage(item.stage_key);
                  setPage(1);
                }}
                type="button"
              >
                {item.stage_name}
              </button>
            ))}
          </div>
          <div
            className="flex shrink-0 gap-1.5 max-[900px]:self-center"
            ref={leadToolsRef}
          >
            <div className="relative">
              <button
                aria-expanded={openTool === "filter"}
                aria-label="Filter leads"
                className={`relative flex size-10 items-center justify-center rounded-[9px] border p-0 text-[#e8e8e8] outline-none focus-visible:ring-2 focus-visible:ring-[#65c9a7] ${activeFilterCount || openTool === "filter" ? "border-[#565656] bg-[#333]" : "border-[#393939] bg-[#242424] hover:border-[#565656] hover:bg-[#333]"} [&_svg]:size-[21px] [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:1.8]`}
                onClick={() =>
                  setOpenTool((current) =>
                    current === "filter" ? null : "filter",
                  )
                }
                title="Filter leads"
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M4 5h16l-6.5 7.2V19l-3 1v-7.8L4 5Z" />
                </svg>
                {activeFilterCount > 0 && (
                  <span className="absolute -top-[5px] -right-[5px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#35ae86] px-[3px] text-[9px] text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              {openTool === "filter" && (
                <div className="absolute top-[calc(100%+9px)] right-0 z-20 w-[250px] rounded-xl border border-[#363636] bg-[#151515] p-3.5 text-[#f4f4f4] shadow-[0_18px_50px_rgba(0,0,0,0.55)] [&>label]:mt-[11px] [&>label]:flex [&>label]:flex-col [&>label]:gap-1.5 [&>label>span:first-child]:text-[10px] [&>label>span:first-child]:text-[#999]">
                  <header className="mb-[13px] flex items-center justify-between">
                    <strong className="text-[13px]">Filter leads</strong>
                    <button
                      className="border-0 bg-transparent text-[11px] text-[#65c9a7]"
                      onClick={() => {
                        setStatus("all");
                        setTemperature("all");
                        setAssignment("all");
                        setPage(1);
                      }}
                      type="button"
                    >
                      Reset
                    </button>
                  </header>
                  <label>
                    <span>Status</span>
                    <span className="relative block">
                      <select
                        className="block h-[38px] w-full appearance-none rounded-lg border border-[#363636] bg-[#0d0d0d] pr-[38px] pl-2.5 text-xs text-[#ededed] outline-none focus:border-[#65c9a7] focus:ring-2 focus:ring-[#65c9a7]/15"
                        onChange={(event) => {
                          setStatus(event.target.value);
                          setPage(1);
                        }}
                        value={status}
                      >
                        {leadStatuses.map((item) => (
                          <option key={item} value={item}>
                            {item === "all" ? "All statuses" : label(item)}
                          </option>
                        ))}
                      </select>
                      <i
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 right-[15px] size-2 -translate-y-[65%] rotate-45 border-r-[1.7px] border-b-[1.7px] border-[#d6d6d6]"
                      />
                    </span>
                  </label>
                  <label>
                    <span>Temperature</span>
                    <span className="relative block">
                      <select
                        className="block h-[38px] w-full appearance-none rounded-lg border border-[#363636] bg-[#0d0d0d] pr-[38px] pl-2.5 text-xs text-[#ededed] outline-none focus:border-[#65c9a7] focus:ring-2 focus:ring-[#65c9a7]/15"
                        onChange={(event) => {
                          setTemperature(event.target.value);
                          setPage(1);
                        }}
                        value={temperature}
                      >
                        <option value="all">All temperatures</option>
                        <option value="hot">Hot</option>
                        <option value="warm">Warm</option>
                        <option value="cold">Cold</option>
                      </select>
                      <i
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 right-[15px] size-2 -translate-y-[65%] rotate-45 border-r-[1.7px] border-b-[1.7px] border-[#d6d6d6]"
                      />
                    </span>
                  </label>
                  <label>
                    <span>Assignment</span>
                    <span className="relative block">
                      <select
                        className="block h-[38px] w-full appearance-none rounded-lg border border-[#363636] bg-[#0d0d0d] pr-[38px] pl-2.5 text-xs text-[#ededed] outline-none focus:border-[#65c9a7] focus:ring-2 focus:ring-[#65c9a7]/15"
                        onChange={(event) => {
                          setAssignment(event.target.value);
                          setPage(1);
                        }}
                        value={assignment}
                      >
                        <option value="all">All leads</option>
                        <option value="assigned">Assigned</option>
                        <option value="unassigned">Unassigned</option>
                      </select>
                      <i
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 right-[15px] size-2 -translate-y-[65%] rotate-45 border-r-[1.7px] border-b-[1.7px] border-[#d6d6d6]"
                      />
                    </span>
                  </label>
                </div>
              )}
            </div>
            <div className="relative">
              <button
                aria-expanded={openTool === "sort"}
                aria-label="Sort leads"
                className={`relative flex size-10 items-center justify-center rounded-[9px] border p-0 text-[#e8e8e8] outline-none focus-visible:ring-2 focus-visible:ring-[#65c9a7] ${sort !== "newest" || openTool === "sort" ? "border-[#565656] bg-[#333]" : "border-[#393939] bg-[#242424] hover:border-[#565656] hover:bg-[#333]"} [&_svg]:size-[21px] [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:1.8]`}
                onClick={() =>
                  setOpenTool((current) => (current === "sort" ? null : "sort"))
                }
                title="Sort leads"
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M5 7h14M5 12h10M5 17h6" />
                </svg>
              </button>
              {openTool === "sort" && (
                <div className="absolute top-[calc(100%+9px)] right-0 z-20 w-[220px] rounded-xl border border-[#363636] bg-[#151515] p-2 text-[#f4f4f4] shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
                  <strong className="block px-[9px] pt-[7px] pb-2 text-[13px] text-[#969696]">
                    Sort by
                  </strong>
                  {sortOptions.map((option) => (
                    <button
                      className={`flex w-full items-center justify-between rounded-[7px] border-0 p-[9px] text-left text-xs ${sort === option.value ? "bg-[#2d2d2d] text-white" : "bg-transparent text-[#d4d4d4] hover:bg-[#2d2d2d] hover:text-white"}`}
                      key={option.value}
                      onClick={() => {
                        setSort(option.value);
                        setPage(1);
                        setOpenTool(null);
                      }}
                      type="button"
                    >
                      <span>{option.label}</span>
                      {sort === option.value && (
                        <i
                          aria-hidden="true"
                          className="text-[#65c9a7] not-italic"
                        >
                          ✓
                        </i>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <section className="overflow-hidden rounded-2xl border border-[#2c2c2c] bg-[#080808]">
          <header className="flex items-center justify-between border-b border-[#2c2c2c] bg-[#191919] p-3 font-[var(--font-bricolage)] text-sm [&>div]:flex [&>div]:gap-2 [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-base [&_button]:text-[#b4b4b4]">
            <strong>
              {selectedProject
                ? `${selectedProject.project_name} leads`
                : "All leads"}
            </strong>
            <div>
              <button
                aria-label="Refresh leads"
                onClick={() => void loadLeads()}
                type="button"
              >
                ↻
              </button>
              <button aria-label="More lead actions" type="button">
                •••
              </button>
            </div>
          </header>
          <div
            aria-busy={loading}
            className={`relative h-[clamp(380px,calc(100dvh-430px),760px)] overflow-auto max-[560px]:h-[clamp(360px,calc(100dvh-330px),620px)] [&_table]:w-full [&_table]:min-w-[920px] [&_table]:border-collapse [&_table]:transition-all [&_th]:sticky [&_th]:top-0 [&_th]:z-[2] [&_th]:h-10 [&_th]:bg-[#080808] [&_th]:px-3 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-medium [&_th]:text-[#8a8d93] [&_th:first-child]:pl-[17px] [&_td]:h-[72px] [&_td]:whitespace-nowrap [&_td]:border-t [&_td]:border-[#2c2c2c] [&_td]:px-3 [&_td]:text-xs [&_td]:text-[#b4b4b4] [&_td:first-child]:flex [&_td:first-child]:items-center [&_td:first-child]:gap-3 [&_td:first-child]:pl-[17px] ${loading && data.leads.length ? "[&_table]:translate-y-0.5 [&_table]:opacity-45" : ""}`}
          >
            <table>
              <thead>
                <tr>
                  <th>Lead</th>
                  {showProjectColumn && <th>Project</th>}
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Source</th>
                  <th>Subsource</th>
                  <th>Next follow-up</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading && data.leads.length === 0 && !error && (
                  <tr>
                    <td
                      className="h-[150px]! text-center"
                      colSpan={tableColumnCount}
                    >
                      Loading leads…
                    </td>
                  </tr>
                )}
                {!loading && error && (
                  <tr>
                    <td
                      className="h-[150px]! text-center"
                      colSpan={tableColumnCount}
                    >
                      {error}
                    </td>
                  </tr>
                )}
                {!loading && !error && data.leads.length === 0 && (
                  <tr>
                    <td
                      className="h-[150px]! text-center"
                      colSpan={tableColumnCount}
                    >
                      No leads match your filters.
                    </td>
                  </tr>
                )}
                {!error &&
                  data.leads.map((lead) => (
                    <tr
                      className={`cursor-pointer transition-colors hover:bg-[#101010] focus-visible:bg-[#101010] focus-visible:shadow-[inset_2px_0_#35ae86] focus-visible:outline-none ${actionMenuLead === lead.lead_id ? "relative z-30 [&>td]:relative [&>td]:z-30" : ""}`}
                      key={lead.lead_id}
                      onClick={() => openLeadOverview(lead)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openLeadOverview(lead);
                        }
                      }}
                      tabIndex={0}
                    >
                      <td>
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#363636] text-[11px] text-[#f5f5f5]">
                          {`${lead.first_name?.[0] || "?"}${lead.last_name?.[0] || ""}`.toUpperCase()}
                        </span>
                        <span className="flex flex-col gap-[3px]">
                          <strong className="text-[13px] text-[#f5f5f5]">
                            {[lead.first_name, lead.last_name]
                              .filter(Boolean)
                              .join(" ") || "Unnamed lead"}
                          </strong>
                          <small className="text-[11px] text-[#8a8d93]">
                            {lead.email || "No email"}
                          </small>
                        </span>
                      </td>
                      {showProjectColumn && (
                        <td>
                          <span className="flex flex-col gap-[3px]">
                            <strong className="text-xs font-medium text-[#d6d6d6]">
                              {lead.project_name || "—"}
                            </strong>
                            <small className="text-[10px] text-[#70746f]">
                              {lead.project_code || ""}
                            </small>
                          </span>
                        </td>
                      )}
                      <td>{lead.email || "—"}</td>
                      <td>
                        <LeadStatus lead={lead} />
                      </td>
                      <td>
                        {lead.current_owner_user_id ? "Assigned" : "Unassigned"}
                      </td>
                      <td>{lead.source_id ? "Source" : "—"}</td>
                      <td>{lead.sub_source || "—"}</td>
                      <td>
                        {lead.updated_at
                          ? new Date(lead.updated_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td
                        className={
                          actionMenuLead === lead.lead_id ? "relative z-30" : ""
                        }
                      >
                        <span
                          className={`relative inline-block ${actionMenuLead === lead.lead_id ? "z-[31]" : "z-[1]"}`}
                          data-lead-row-actions
                        >
                          <button
                            aria-expanded={actionMenuLead === lead.lead_id}
                            aria-haspopup="menu"
                            aria-label={`Actions for ${lead.first_name || "lead"}`}
                            className="h-auto w-auto border-0 bg-transparent px-0 pt-[3px] pb-[5px] text-[10px] leading-none tracking-[0.75px] text-[#b4b4b4] outline-none focus-visible:text-white"
                            disabled={actionLead === lead.lead_id}
                            onClick={(event) => {
                              event.stopPropagation();
                              setActionMenuLead((current) =>
                                current === lead.lead_id ? null : lead.lead_id,
                              );
                            }}
                            type="button"
                          >
                            •••
                          </button>
                          {actionMenuLead === lead.lead_id && (
                            <div
                              className="absolute top-[calc(100%+7px)] right-0 z-50 min-w-40 rounded-[9px] border border-[#363636] bg-[#151515] p-[5px] shadow-[0_15px_35px_rgba(0,0,0,0.55)] [&_button]:block [&_button]:w-full [&_button]:rounded-md [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-[9px] [&_button]:py-2 [&_button]:text-left [&_button]:text-[11px] [&_button]:text-[#d0d0d0] [&_button]:hover:bg-[#2b2b2b] [&_button]:hover:text-white"
                              onClick={(event) => event.stopPropagation()}
                              role="menu"
                            >
                              {leadActions.map((option) => (
                                <button
                                  key={option.value}
                                  onClick={() =>
                                    void runLeadAction(
                                      lead.lead_id,
                                      option.value,
                                    )
                                  }
                                  role="menuitem"
                                  type="button"
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {loading && data.leads.length > 0 && (
              <div
                className="pointer-events-none absolute top-[54px] left-1/2 z-[4] flex -translate-x-1/2 items-center gap-2 bg-[#080808]/40 px-3 py-2 text-[11px] text-[#d1d1d1]"
                role="status"
              >
                <i
                  aria-hidden="true"
                  className="size-[13px] animate-spin rounded-full border-2 border-[#555] border-t-[#f2f2f2]"
                />
                <span>Updating leads</span>
              </div>
            )}
          </div>
          <footer className="flex items-center justify-between border-t border-[#2c2c2c] px-[17px] py-3 text-[11px] text-[#8a8d93] [&>div]:flex [&>div]:items-center [&>div]:gap-3 [&_button]:rounded-md [&_button]:border [&_button]:border-[#2c2c2c] [&_button]:bg-transparent [&_button]:px-[9px] [&_button]:py-1.5 [&_button]:text-[11px] [&_button]:text-[#b4b4b4] [&_button:disabled]:opacity-40">
            <span>
              {data.leads.length} of {total} leads
            </span>
            <div>
              <button
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
                type="button"
              >
                Previous
              </button>
              <span>
                Page {page}
                {data.pagination?.totalPages
                  ? ` of ${data.pagination.totalPages}`
                  : ""}
              </span>
              <button
                disabled={
                  data.pagination?.totalPages
                    ? page >= data.pagination.totalPages
                    : data.leads.length < 10
                }
                onClick={() => setPage((value) => value + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          </footer>
        </section>
      </section>
      {selectedLead && (
        <div
          className="fixed inset-0 z-[80] bg-black/70"
          onMouseDown={() => setSelectedLead(null)}
        >
          <aside
            aria-label="Lead overview"
            className="absolute inset-y-0 right-0 flex w-full max-w-[589px] flex-col border-l border-[#2c2c2c] bg-[#111] text-[#f5f5f5] shadow-[-8px_4px_24px_rgba(16,21,16,0.28)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex basis-[72px] items-center justify-between border-b border-[#2c2c2c] px-4">
              <strong className="font-[var(--font-bricolage)] text-xl">
                Lead Overview
              </strong>
              <button
                className="border-0 bg-transparent p-1 text-[25px] leading-none text-[#c8c8c8]"
                aria-label="Close lead overview"
                onClick={() => setSelectedLead(null)}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(() => {
                const currentLead = leadDetail ?? selectedLead;
                const contact = leadDetail?.contact;
                const name =
                  [
                    contact?.first_name ?? currentLead.first_name,
                    contact?.last_name ?? currentLead.last_name,
                  ]
                    .filter(Boolean)
                    .join(" ") || "Unnamed lead";
                const phone = contact?.phone_number ?? currentLead.phone_number;
                const email = contact?.email ?? currentLead.email;
                const description =
                  leadDetail?.buying_reason ||
                  "No description has been added for this lead.";
                return (
                  <>
                    <section className="flex min-h-[84px] items-center gap-3.5 border-b border-[#2c2c2c] px-[22px] max-[560px]:gap-2.5 max-[560px]:px-4">
                      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#363636] text-sm text-[#f5f5f5]">
                        {`${name[0] || "?"}${name.split(" ")[1]?.[0] || ""}`.toUpperCase()}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                        <strong className="overflow-hidden text-lg text-ellipsis whitespace-nowrap max-[560px]:text-[15px]">
                          {name}
                        </strong>
                        <span className="overflow-hidden text-[11px] text-ellipsis whitespace-nowrap text-[#b4b4b4]">
                          {label(currentLead.stage_name || currentLead.status)}{" "}
                          · ID:
                          {currentLead.lead_id.slice(0, 8)}
                        </span>
                      </div>
                      {phone ? (
                        <a
                          href={`tel:${phone}`}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#216939] px-[15px] py-[11px] text-xs text-white no-underline shadow-[inset_0_4px_12px_rgba(0,0,0,0.25)] max-[560px]:px-2.5 max-[560px]:py-[9px] max-[560px]:text-[11px]"
                        >
                          <svg
                            aria-hidden="true"
                            className="size-[15px] shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]"
                            viewBox="0 0 24 24"
                          >
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92Z" />
                          </svg>
                          <span>Call your lead</span>
                        </a>
                      ) : null}
                      <button
                        aria-label="More lead options"
                        className="border-0 bg-transparent p-1 text-[25px] leading-none text-[#d2d2d2]"
                        type="button"
                      >
                        ⋮
                      </button>
                    </section>
                    <section className="border-b border-[#2c2c2c] p-[18px]">
                      <h2 className="mb-[18px] font-[var(--font-bricolage)] text-lg">
                        Lead details
                      </h2>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-4 max-[560px]:gap-x-3 max-[560px]:gap-y-3.5 [&>div]:flex [&>div]:min-w-0 [&>div]:flex-col [&>div]:gap-1 [&_span]:text-[11px] [&_span]:text-[#b4b4b4] [&_strong]:text-[13px] [&_strong]:font-medium [&_strong]:text-[#f5f5f5] [&_strong]:[overflow-wrap:anywhere]">
                        <div>
                          <span>Project</span>
                          <strong>
                            {leadDetail?.project_name ||
                              selectedLead.project_name ||
                              selectedProject?.project_name ||
                              "—"}
                          </strong>
                        </div>
                        <div>
                          <span>Status</span>
                          <strong>{label(currentLead.status)}</strong>
                        </div>
                        <div>
                          <span>Stage</span>
                          <strong>
                            {leadDetail?.stage?.stage_name ||
                              currentLead.stage_name ||
                              "—"}
                          </strong>
                        </div>
                        <div>
                          <span>Owner</span>
                          <strong>
                            {currentLead.current_owner_user_id ||
                            currentLead.current_team_id
                              ? "Assigned"
                              : "Unassigned"}
                          </strong>
                        </div>
                        <div>
                          <span>Temperature</span>
                          <strong>{label(currentLead.temperature)}</strong>
                        </div>
                        <div>
                          <span>Source</span>
                          <strong>
                            {currentLead.source_id
                              ? "Lead source"
                              : currentLead.sub_source || "—"}
                          </strong>
                        </div>
                        <div>
                          <span>Budget</span>
                          <strong>{formatBudget(leadDetail?.budget)}</strong>
                        </div>
                        <div>
                          <span>Phone number</span>
                          <strong>{phone || "—"}</strong>
                        </div>
                        <div>
                          <span>Email</span>
                          <strong>{email || "—"}</strong>
                        </div>
                        <div>
                          <span>Preferred location</span>
                          <strong>
                            {leadDetail?.preferred_location || "—"}
                          </strong>
                        </div>
                        <div>
                          <span>Configuration</span>
                          <strong>{leadDetail?.preferred_config || "—"}</strong>
                        </div>
                        <div className="col-span-full">
                          <span>Description</span>
                          <strong>{description}</strong>
                        </div>
                      </div>
                    </section>
                    <section className="min-h-[450px] px-[18px] pb-6">
                      <nav
                        className="mb-[22px] grid grid-cols-4"
                        aria-label="Lead activity tabs"
                      >
                        {(["activity", "calls", "email", "notes"] as const).map(
                          (tab) => (
                            <button
                              className={`border-0 border-b-2 bg-transparent px-1 pt-3.5 pb-[11px] font-[var(--font-bricolage)] text-sm ${drawerTab === tab ? "border-b-[#35ae86] text-[#f5f5f5]" : "border-b-transparent text-[#b4b4b4]"}`}
                              key={tab}
                              onClick={() => setDrawerTab(tab)}
                              type="button"
                            >
                              {label(tab)}
                            </button>
                          ),
                        )}
                      </nav>
                      {drawerLoading && (
                        <p className="px-0 py-5 text-xs leading-normal text-[#8d8d8d]">
                          Loading lead activity…
                        </p>
                      )}
                      {!drawerLoading && drawerError && (
                        <p className="px-0 py-5 text-xs leading-normal text-[#8d8d8d]">
                          {drawerError}
                        </p>
                      )}
                      {!drawerLoading &&
                        !drawerError &&
                        drawerTab === "activity" && (
                          <div className="flex flex-col gap-[22px]">
                            {timeline.length === 0 && (
                              <p className="px-0 py-5 text-xs leading-normal text-[#8d8d8d]">
                                No activity recorded yet.
                              </p>
                            )}
                            {timeline.map((event) => (
                              <article
                                className="flex min-h-[92px] gap-3"
                                key={event.event_id}
                              >
                                <span className="flex basis-[18px] flex-col items-center after:mt-2 after:w-px after:flex-1 after:bg-[#2c2c2c] last:after:hidden">
                                  <i className="block size-4 rounded-full border border-[#3a3a3a] bg-[#111]" />
                                </span>
                                <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                                  <strong className="text-xs font-medium text-[#f5f5f5]">
                                    {timelineTitle(event)}
                                  </strong>
                                  <small className="text-[10px] text-[#70746f]">
                                    {new Date(
                                      event.occurred_at,
                                    ).toLocaleString()}
                                  </small>
                                  <p className="mt-[3px] rounded-lg border border-[#2c2c2c] bg-[#191919] p-3 text-[11px] leading-[1.35] text-[#d0d0d0]">
                                    {timelineDescription(event)}
                                  </p>
                                </div>
                              </article>
                            ))}
                          </div>
                        )}
                      {!drawerLoading &&
                        !drawerError &&
                        drawerTab === "notes" && (
                          <p className="px-0 py-5 text-xs leading-normal whitespace-pre-wrap text-[#d1d1d1]">
                            {description}
                          </p>
                        )}
                      {!drawerLoading &&
                        !drawerError &&
                        (drawerTab === "calls" || drawerTab === "email") && (
                          <p className="px-0 py-5 text-xs leading-normal text-[#8d8d8d]">
                            No {drawerTab} activity recorded yet.
                          </p>
                        )}
                    </section>
                  </>
                );
              })()}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
