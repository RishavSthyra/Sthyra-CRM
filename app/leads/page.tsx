"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";

type Lead = {
  lead_id: string;
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

const statuses = [
  "all",
  "active",
  "qualified",
  "nurture",
  "closed",
  "duplicate",
  "invalid",
];

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
  return (
    <span className={`lead-status lead-status-${value.toLowerCase()}`}>
      <i />
      {label(value)}
    </span>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
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

  const loadLeads = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "10" });
    if (search.trim()) params.set("search", search.trim());
    if (status !== "all") params.set("status", status);
    if (temperature !== "all") params.set("temperature", temperature);
    if (assignment !== "all") params.set("assignment", assignment);
    params.set("sort", sort);
    try {
      const response = await fetch(`/api/leads?${params.toString()}`, {
        cache: "no-store",
      });
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
  }, [assignment, page, search, sort, status, temperature]);

  useEffect(() => {
    void loadLeads();
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
      if (!(event.target as Element).closest(".lead-row-actions-wrap")) {
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
    if (!selectedLeadId) {
      setLeadDetail(null);
      setTimeline([]);
      setDrawerError(null);
      return;
    }

    let cancelled = false;
    setDrawerLoading(true);
    setDrawerError(null);
    setLeadDetail(null);
    setTimeline([]);
    setDrawerTab("activity");

    async function loadLeadOverview() {
      try {
        const [leadResponse, timelineResponse] = await Promise.all([
          fetch(`/api/leads/${selectedLeadId}`, { cache: "no-store" }),
          fetch(`/api/leads/${selectedLeadId}/timeline?limit=20`, {
            cache: "no-store",
          }),
        ]);
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
  }, [selectedLeadId]);

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
      const response = await fetch(`/api/leads/${leadId}/${action}`, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
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

  return (
    <main className="dashboard-page">
      <DashboardSidebar activeLabel="Leads" />
      <section className="dashboard-content">
        <div className="dashboard-heading">
          <span>Workspace / Leads</span>
          <h1>Leads</h1>
          <p>Every relationship. One clear next step.</p>
        </div>
        <section className="lead-overview">
          <header>Overview</header>
          <div className="lead-metrics">
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
        <div className="lead-tools">
          <label className="lead-search">
            <span aria-hidden="true">⌕</span>
            <input
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search leads by name, email or phone"
              value={search}
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="lead-segments">
            {["all", "active", "qualified"].map((item) => (
              <button
                className={status === item ? "is-selected" : ""}
                key={item}
                onClick={() => {
                  setStatus(item);
                  setPage(1);
                }}
                type="button"
              >
                {label(item === "all" ? "Leads" : item)}
              </button>
            ))}
          </div>
          <div className="lead-view-tools" ref={leadToolsRef}>
            <div className="lead-tool-menu">
              <button
                aria-expanded={openTool === "filter"}
                aria-label="Filter leads"
                className={activeFilterCount ? "is-active" : ""}
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
                {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
              </button>
              {openTool === "filter" && (
                <div className="lead-tool-popover lead-filter-popover">
                  <header>
                    <strong>Filter leads</strong>
                    <button
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
                    <span className="lead-select-wrap">
                      <select
                        onChange={(event) => {
                          setStatus(event.target.value);
                          setPage(1);
                        }}
                        value={status}
                      >
                        {statuses.map((item) => (
                          <option key={item} value={item}>
                            {label(item)}
                          </option>
                        ))}
                      </select>
                      <i aria-hidden="true" />
                    </span>
                  </label>
                  <label>
                    <span>Temperature</span>
                    <span className="lead-select-wrap">
                      <select
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
                      <i aria-hidden="true" />
                    </span>
                  </label>
                  <label>
                    <span>Assignment</span>
                    <span className="lead-select-wrap">
                      <select
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
                      <i aria-hidden="true" />
                    </span>
                  </label>
                </div>
              )}
            </div>
            <div className="lead-tool-menu">
              <button
                aria-expanded={openTool === "sort"}
                aria-label="Sort leads"
                className={sort !== "newest" ? "is-active" : ""}
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
                <div className="lead-tool-popover lead-sort-popover">
                  <strong>Sort by</strong>
                  {sortOptions.map((option) => (
                    <button
                      className={sort === option.value ? "is-selected" : ""}
                      key={option.value}
                      onClick={() => {
                        setSort(option.value);
                        setPage(1);
                        setOpenTool(null);
                      }}
                      type="button"
                    >
                      <span>{option.label}</span>
                      {sort === option.value && <i aria-hidden="true">✓</i>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <section className="lead-table-card">
          <header>
            <strong>All leads</strong>
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
            className={`lead-table-wrap${loading && data.leads.length ? " is-refreshing" : ""}`}
          >
            <table>
              <thead>
                <tr>
                  <th>Lead</th>
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
                    <td className="lead-empty" colSpan={8}>
                      Loading leads…
                    </td>
                  </tr>
                )}
                {!loading && error && (
                  <tr>
                    <td className="lead-empty" colSpan={8}>
                      {error}
                    </td>
                  </tr>
                )}
                {!loading && !error && data.leads.length === 0 && (
                  <tr>
                    <td className="lead-empty" colSpan={8}>
                      No leads match your filters.
                    </td>
                  </tr>
                )}
                {!error &&
                  data.leads.map((lead) => (
                    <tr
                      className={`lead-row-clickable${actionMenuLead === lead.lead_id ? " is-actions-open" : ""}`}
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
                        <span className="lead-avatar">
                          {`${lead.first_name?.[0] || "?"}${lead.last_name?.[0] || ""}`.toUpperCase()}
                        </span>
                        <span className="lead-identity">
                          <strong>
                            {[lead.first_name, lead.last_name]
                              .filter(Boolean)
                              .join(" ") || "Unnamed lead"}
                          </strong>
                          <small>{lead.email || "No email"}</small>
                        </span>
                      </td>
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
                          actionMenuLead === lead.lead_id
                            ? "lead-row-actions-cell is-actions-open"
                            : "lead-row-actions-cell"
                        }
                      >
                        <span className="lead-row-actions-wrap">
                          <button
                            aria-expanded={actionMenuLead === lead.lead_id}
                            aria-haspopup="menu"
                            aria-label={`Actions for ${lead.first_name || "lead"}`}
                            className="lead-row-actions"
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
                              className="lead-row-action-menu"
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
              <div className="lead-refresh-overlay" role="status">
                <i aria-hidden="true" />
                <span>Updating leads</span>
              </div>
            )}
          </div>
          <footer>
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
          className="lead-drawer-backdrop"
          onMouseDown={() => setSelectedLead(null)}
        >
          <aside
            aria-label="Lead overview"
            className="lead-drawer"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="lead-drawer-heading">
              <strong>Lead Overview</strong>
              <button
                aria-label="Close lead overview"
                onClick={() => setSelectedLead(null)}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="lead-drawer-scroll">
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
                    <section className="lead-drawer-profile">
                      <span className="lead-drawer-avatar">
                        {`${name[0] || "?"}${name.split(" ")[1]?.[0] || ""}`.toUpperCase()}
                      </span>
                      <div>
                        <strong>{name}</strong>
                        <span>
                          {label(currentLead.stage_name || currentLead.status)}{" "}
                          · ID:
                          {currentLead.lead_id.slice(0, 8)}
                        </span>
                      </div>
                      {phone ? (
                        <a href={`tel:${phone}`} className="lead-call-button">
                          <svg
                            aria-hidden="true"
                            className="lead-call-icon"
                            viewBox="0 0 24 24"
                          >
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92Z" />
                          </svg>
                          <span>Call your lead</span>
                        </a>
                      ) : null}
                      <button
                        aria-label="More lead options"
                        className="lead-drawer-more"
                        type="button"
                      >
                        ⋮
                      </button>
                    </section>
                    <section className="lead-drawer-details">
                      <h2>Lead details</h2>
                      <div className="lead-drawer-grid">
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
                        <div className="lead-drawer-detail-wide">
                          <span>Description</span>
                          <strong>{description}</strong>
                        </div>
                      </div>
                    </section>
                    <section className="lead-drawer-activity">
                      <nav
                        className="lead-drawer-tabs"
                        aria-label="Lead activity tabs"
                      >
                        {(["activity", "calls", "email", "notes"] as const).map(
                          (tab) => (
                            <button
                              className={drawerTab === tab ? "is-active" : ""}
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
                        <p className="lead-drawer-message">
                          Loading lead activity…
                        </p>
                      )}
                      {!drawerLoading && drawerError && (
                        <p className="lead-drawer-message">{drawerError}</p>
                      )}
                      {!drawerLoading &&
                        !drawerError &&
                        drawerTab === "activity" && (
                          <div className="lead-drawer-timeline">
                            {timeline.length === 0 && (
                              <p className="lead-drawer-message">
                                No activity recorded yet.
                              </p>
                            )}
                            {timeline.map((event) => (
                              <article
                                className="lead-timeline-event"
                                key={event.event_id}
                              >
                                <span className="lead-timeline-rail">
                                  <i />
                                </span>
                                <div>
                                  <strong>{timelineTitle(event)}</strong>
                                  <small>
                                    {new Date(
                                      event.occurred_at,
                                    ).toLocaleString()}
                                  </small>
                                  <p>{timelineDescription(event)}</p>
                                </div>
                              </article>
                            ))}
                          </div>
                        )}
                      {!drawerLoading &&
                        !drawerError &&
                        drawerTab === "notes" && (
                          <p className="lead-drawer-note">{description}</p>
                        )}
                      {!drawerLoading &&
                        !drawerError &&
                        (drawerTab === "calls" || drawerTab === "email") && (
                          <p className="lead-drawer-message">
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
