"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Funnel,
  ListFilter,
  Mail,
  Phone,
  StickyNote,
  X,
} from "lucide-react";
import {
  CallsView,
  EmailView,
  NotesView,
  TasksView,
} from "@/components/activity/ActivityTabViews";
import { RichTextContent } from "@/components/activity/RichTextEditor";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";

type ActivityTab = "activity" | "calls" | "email" | "tasks" | "notes";
type ActivityFilter = "all" | "appointment" | "call" | "email" | "task" | "note";
type DateRange = "all" | "today" | "week" | "month";
type SortOrder = "newest" | "oldest";
type EmailComposeContext = { key: string; leadId: string; to: string };

type Project = {
  project_id: number;
  project_code: string;
  project_name: string;
};

type ProjectContext = {
  company?: { company_name?: string };
  can_view_all_projects?: boolean;
  projects?: Project[];
  error?: string;
};

type ActivityRecord = {
  activity_id: string;
  project_id: number;
  project_name?: string;
  lead_id?: string | null;
  contact_id?: string | null;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  activity_type: string;
  source_type: "task" | "note" | "appointment" | "call" | "email";
  source_appointment_type?: string | null;
  source_starts_at?: string | null;
  source_description?: string | null;
  source_direction?: string | null;
  source_status?: string | null;
  source_outcome?: string | null;
  source_phone_number?: string | null;
  source_duration_seconds?: number | null;
  source_from_address?: string | null;
  source_to_addresses?: string[] | null;
  source_id: string;
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  occurred_at: string;
  actor_first_name?: string | null;
  actor_last_name?: string | null;
};

type TimelineResponse = {
  timeline?: ActivityRecord[];
  pagination?: { total?: number };
  error?: string;
};

const tabs: Array<{ id: ActivityTab; label: string }> = [
  { id: "activity", label: "Activity" },
  { id: "calls", label: "Calls" },
  { id: "email", label: "Email" },
  { id: "tasks", label: "Tasks" },
  { id: "notes", label: "Notes" },
];

const dateRanges: Array<{ id: DateRange; label: string }> = [
  { id: "all", label: "Any time" },
  { id: "today", label: "Today" },
  { id: "week", label: "Last 7 days" },
  { id: "month", label: "Last 30 days" },
];

const filterOptions: Array<{ id: ActivityFilter; label: string }> = [
  { id: "all", label: "All activity" },
  { id: "call", label: "Calls" },
  { id: "email", label: "Emails" },
  { id: "appointment", label: "Appointments" },
  { id: "task", label: "Tasks" },
  { id: "note", label: "Notes" },
];

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function startOfWeek(date: Date) {
  const value = startOfDay(date);
  const day = value.getDay() || 7;
  value.setDate(value.getDate() - day + 1);
  return value;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function relativeTime(value: string) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const seconds = Math.round((time - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 365 * 24 * 60 * 60],
    ["month", 30 * 24 * 60 * 60],
    ["week", 7 * 24 * 60 * 60],
    ["day", 24 * 60 * 60],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, divisor] of units) {
    if (Math.abs(seconds) >= divisor) {
      return formatter.format(Math.round(seconds / divisor), unit);
    }
  }
  return "just now";
}

function formatDuration(value?: number | null) {
  if (value === undefined || value === null) return "—";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function label(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function activityPerson(activity: ActivityRecord) {
  const actor = [activity.actor_first_name, activity.actor_last_name]
    .filter(Boolean)
    .join(" ");
  const contact = [activity.contact_first_name, activity.contact_last_name]
    .filter(Boolean)
    .join(" ");
  return actor || contact || "CRM";
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function activityKind(activity: ActivityRecord) {
  const appointmentType = String(
    activity.source_appointment_type ??
      activity.metadata?.appointment_type ??
      "",
  );
  if (appointmentType === "call" || activity.activity_type.includes("call")) {
    return "call";
  }
  if (activity.activity_type.includes("email")) return "email";
  return activity.source_type;
}

function ActivityMarkerIcon({ activity }: { activity: ActivityRecord }) {
  const kind = activityKind(activity);
  if (kind === "call") {
    return <Phone aria-hidden className="size-2.5" strokeWidth={2} />;
  }
  if (kind === "email") {
    return <Mail aria-hidden className="size-2.5" strokeWidth={2} />;
  }
  if (kind === "task") {
    return <CheckCircle2 aria-hidden className="size-2.5" strokeWidth={2} />;
  }
  if (kind === "note") {
    return <StickyNote aria-hidden className="size-2.5" strokeWidth={2} />;
  }
  return <CalendarDays aria-hidden className="size-2.5" strokeWidth={2} />;
}

function markerTone(activity: ActivityRecord) {
  const kind = activityKind(activity);
  if (kind === "call") return "border-[#2aa284]/45 bg-[#173e34] text-[#70d5b4]";
  if (kind === "email") return "border-[#a58bfa]/35 bg-[#302a4b] text-[#b7a7f8]";
  if (kind === "task") return "border-[#efc36a]/35 bg-[#433719] text-[#efc36a]";
  if (kind === "note") return "border-[#e79870]/35 bg-[#472d22] text-[#efa27c]";
  return "border-[#75a7e8]/35 bg-[#20354e] text-[#89b9ef]";
}

function CalendarCard({ activity }: { activity: ActivityRecord }) {
  const appointmentTime =
    activity.source_starts_at ||
    String(activity.metadata?.starts_at ?? "") ||
    activity.occurred_at;
  const date = new Date(appointmentTime);
  const person = activityPerson(activity);
  return (
    <div className="flex min-h-14 items-center rounded-[9px] border border-[#2c2c2c] bg-[#191919] px-3.5 py-2.5">
      <div className="flex w-14 shrink-0 flex-col border-r border-[#353535] pr-3 text-center">
        <span className="text-[9px] tracking-[0.08em] text-[#8f9291] uppercase">
          {Number.isNaN(date.getTime())
            ? "—"
            : new Intl.DateTimeFormat("en-IN", { month: "short" }).format(date)}
        </span>
        <strong className="text-sm leading-4 text-[#f1f1f1]">
          {Number.isNaN(date.getTime()) ? "—" : date.getDate()}
        </strong>
      </div>
      <div className="min-w-0 flex-1 px-3.5">
        <p className="truncate text-[11px] font-medium text-[#f0f0f0]">
          {activity.title}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-[#858887]">
          {formatTime(appointmentTime)}
          {activity.project_name ? ` · ${activity.project_name}` : ""}
        </p>
      </div>
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#303332] text-[9px] font-semibold text-[#d9dcda]"
        title={person}
      >
        {initials(person)}
      </span>
    </div>
  );
}

function CallCard({ activity }: { activity: ActivityRecord }) {
  const direction = activity.source_direction || String(activity.metadata?.direction ?? "outbound");
  const status = activity.source_status || String(activity.metadata?.status ?? "completed");
  const duration =
    activity.source_duration_seconds ??
    (typeof activity.metadata?.duration_seconds === "number"
      ? activity.metadata.duration_seconds
      : null);
  return (
    <div className="flex min-h-[52px] items-center gap-3 rounded-[9px] border border-[#2c2c2c] bg-[#191919] px-3.5 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#173e34] text-[#70d5b4]">
        <Phone aria-hidden className="size-3.5" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-[#f0f0f0]">
          {activity.title}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-[#858887]">
          {label(direction)} · {activity.source_phone_number || "No number"} · {formatDuration(duration)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <span className="rounded-full bg-[#26332e] px-2 py-1 text-[9px] text-[#86cdb4]">
          {label(status)}
        </span>
        <p className="mt-1 text-[9px] text-[#686b6a]">{relativeTime(activity.occurred_at)}</p>
      </div>
    </div>
  );
}

function DetailCard({ activity }: { activity: ActivityRecord }) {
  const kind = activityKind(activity);
  const description =
    activity.description ||
    activity.source_description ||
    (activity.source_type === "note"
      ? "A note was added to the relationship timeline."
      : `${label(activity.activity_type)} was recorded in the CRM.`);
  return (
    <div className="rounded-[9px] border border-[#2c2c2c] bg-[#191919] px-3.5 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium text-[#f0f0f0]">
            {activity.title}
          </p>
          <p className="mt-0.5 text-[10px] text-[#858887]">
            {kind === "email"
              ? activity.source_from_address || activityPerson(activity)
              : activityPerson(activity)}{" "}
            · {relativeTime(activity.occurred_at)}
          </p>
        </div>
        <span className="shrink-0 text-[9px] text-[#686b6a]">
          {activity.project_name}
        </span>
      </div>
      <RichTextContent
        className="mt-2 line-clamp-2 max-w-4xl text-[10px] leading-[1.55] text-[#a7aaa8]"
        value={description}
      />
    </div>
  );
}

function TimelineItem({
  activity,
  last,
}: {
  activity: ActivityRecord;
  last: boolean;
}) {
  const kind = activityKind(activity);
  const detailed = kind === "note" || kind === "email";
  const call = kind === "call";
  const calendar = activity.source_type === "appointment" && kind !== "call";

  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5">
      <div className="relative flex justify-center">
        {!last && (
          <span className="absolute top-[18px] bottom-[-14px] left-1/2 w-px -translate-x-1/2 bg-[#313332]" />
        )}
        <span
          className={`relative z-[1] flex size-4 items-center justify-center rounded-full border ${markerTone(activity)}`}
        >
          <ActivityMarkerIcon activity={activity} />
        </span>
      </div>
      <div className="min-w-0 pb-3.5">
        {calendar ? (
          <CalendarCard activity={activity} />
        ) : call ? (
          <CallCard activity={activity} />
        ) : detailed ? (
          <DetailCard activity={activity} />
        ) : (
          <div className="min-h-7 pt-px">
            <p className="text-[11px] leading-4 text-[#d9dcda]">
              {activity.title}
            </p>
            <p className="mt-0.5 text-[10px] text-[#737675]">
              {activityPerson(activity)} · {relativeTime(activity.occurred_at)}
              {activity.project_name ? ` · ${activity.project_name}` : ""}
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

function TimelineGroup({
  activities,
  title,
}: {
  activities: ActivityRecord[];
  title: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? activities : activities.slice(0, 6);
  const remaining = activities.length - visible.length;

  return (
    <section className="border-b border-[#252525] py-5 first:pt-0 last:border-b-0 last:pb-0">
      <h2 className="mb-3 font-[var(--font-bricolage)] text-sm font-semibold text-[#f3f3f3]">
        {title}
      </h2>
      <ol>
        {visible.map((activity, index) => (
          <TimelineItem
            activity={activity}
            key={activity.activity_id}
            last={index === visible.length - 1}
          />
        ))}
      </ol>
      {remaining > 0 && (
        <button
          className="ml-[34px] border-0 bg-transparent py-1 text-[10px] font-medium text-[#42b892] transition hover:text-[#75d6b5]"
          onClick={() => setExpanded(true)}
          type="button"
        >
          Show {remaining} more {remaining === 1 ? "activity" : "activities"}
        </button>
      )}
    </section>
  );
}

function ToolButton({
  active,
  children,
  label,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={`relative flex size-7 items-center justify-center rounded-md border text-[#d9dcda] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2aa284]/45 ${
        active
          ? "border-[#2aa284] bg-[#23463b] text-white"
          : "border-[#3b3b3b] bg-[#2c2c2c] hover:border-[#555] hover:bg-[#353535]"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function Popup({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute top-9 right-0 z-40 w-52 overflow-hidden rounded-[10px] border border-[#353837] bg-[#151716] p-1.5 shadow-[0_22px_55px_rgba(0,0,0,0.65)]">
      {children}
    </div>
  );
}

function MenuOption({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center justify-between rounded-md border-0 px-3 py-2 text-left text-[11px] transition ${
        active
          ? "bg-[#243d35] text-[#e9f8f2]"
          : "bg-transparent text-[#b7bab8] hover:bg-white/[0.06] hover:text-white"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
      {active && <Check aria-hidden className="size-3.5 text-[#58c39f]" />}
    </button>
  );
}

export default function ActivityPage() {
  const router = useRouter();
  const toolsRef = useRef<HTMLDivElement>(null);
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(
    null,
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [tab, setTab] = useState<ActivityTab>("activity");
  const [initialEmailCompose, setInitialEmailCompose] =
    useState<EmailComposeContext | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");
  const [openTool, setOpenTool] = useState<"calendar" | "filter" | "sort" | null>(
    null,
  );
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const requestedTab = params.get("tab");
      if (tabs.some((item) => item.id === requestedTab)) {
        setTab(requestedTab as ActivityTab);
      }
      const leadId = params.get("lead_id");
      if (
        requestedTab === "email" &&
        params.get("compose") === "1" &&
        leadId
      ) {
        setInitialEmailCompose({
          key: `${leadId}:${Date.now()}`,
          leadId,
          to: params.get("to") ?? "",
        });
        params.delete("compose");
        params.delete("lead_id");
        params.delete("to");
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}?${params.toString()}`,
        );
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadContext() {
      try {
        const response = await fetchWithSession("/api/auth/project-context", {
          cache: "no-store",
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) throw new Error(await getApiError(response));
        const body = (await response.json()) as ProjectContext;
        if (!active) return;
        const projects = body.projects ?? [];
        const params = new URLSearchParams(window.location.search);
        const requested = params.get("project_id");
        const saved = window.localStorage.getItem("sthyra-project-id");
        const exists = (value: string | null) =>
          Boolean(
            value &&
              (value === "all"
                ? body.can_view_all_projects
                : projects.some(
                    (project) => String(project.project_id) === value,
                  )),
          );
        const initial = exists(requested)
          ? requested
          : exists(saved)
            ? saved
            : body.can_view_all_projects
              ? "all"
              : projects[0]
                ? String(projects[0].project_id)
                : null;
        setProjectContext(body);
        setSelectedProjectId(initial);
        if (!initial) {
          setError("No active projects are available for your account.");
          setLoading(false);
        }
      } catch (cause) {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to retrieve project access.",
        );
        setLoading(false);
      } finally {
        if (active) setContextLoading(false);
      }
    }
    void loadContext();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!selectedProjectId) return;
    window.localStorage.setItem("sthyra-project-id", selectedProjectId);
    const url = new URL(window.location.href);
    url.searchParams.set("project_id", selectedProjectId);
    window.history.replaceState(null, "", url);
  }, [selectedProjectId]);

  const loadActivities = useCallback(async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (selectedProjectId !== "all") {
        params.set("project_id", selectedProjectId);
      }
      if (dateRange !== "all") {
        const now = new Date();
        const from =
          dateRange === "today"
            ? startOfDay(now)
            : new Date(
                now.getTime() -
                  (dateRange === "week" ? 7 : 30) * 24 * 60 * 60 * 1000,
              );
        params.set("from", from.toISOString());
      }
      const response = await fetchWithSession(
        `/api/activities/timeline?${params.toString()}`,
        { cache: "no-store" },
      );
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) throw new Error(await getApiError(response));
      const body = (await response.json()) as TimelineResponse;
      setActivities(body.timeline ?? []);
      setTotal(body.pagination?.total ?? body.timeline?.length ?? 0);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to retrieve activity.",
      );
    } finally {
      setLoading(false);
    }
  }, [dateRange, router, selectedProjectId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadActivities(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadActivities]);

  useEffect(() => {
    if (!openTool) return;
    function closeOutside(event: PointerEvent) {
      if (!toolsRef.current?.contains(event.target as Node)) setOpenTool(null);
    }
    function closeEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenTool(null);
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [openTool]);

  const filteredActivities = useMemo(() => {
    const visible = activities.filter((activity) => {
      const kind = activityKind(activity);
      const inTab =
        tab === "activity" ||
        (tab === "calls" && kind === "call") ||
        (tab === "email" && kind === "email") ||
        (tab === "tasks" && activity.source_type === "task") ||
        (tab === "notes" && activity.source_type === "note");
      const inFilter =
        filter === "all" ||
        (filter === "call" ? kind === "call" : activity.source_type === filter);
      return inTab && inFilter;
    });
    return [...visible].sort((left, right) => {
      const difference =
        new Date(right.occurred_at).getTime() -
        new Date(left.occurred_at).getTime();
      return sort === "newest" ? difference : -difference;
    });
  }, [activities, filter, sort, tab]);

  const groups = useMemo(() => {
    const now = new Date();
    const today = startOfDay(now).getTime();
    const week = startOfWeek(now).getTime();
    const month = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const result: Record<string, ActivityRecord[]> = {
      Today: [],
      "This Week": [],
      "This Month": [],
      Earlier: [],
    };
    for (const activity of filteredActivities) {
      const time = new Date(activity.occurred_at).getTime();
      const bucket =
        time >= today
          ? "Today"
          : time >= week
            ? "This Week"
            : time >= month
              ? "This Month"
              : "Earlier";
      result[bucket].push(activity);
    }
    const ordered = Object.entries(result).filter(
      ([, records]) => records.length > 0,
    );
    return sort === "newest" ? ordered : ordered.reverse();
  }, [filteredActivities, sort]);

  const projects = projectContext?.projects ?? [];
  const activeFilterCount = Number(filter !== "all");
  const creationProjectId =
    selectedProjectId && selectedProjectId !== "all"
      ? Number(selectedProjectId)
      : projects[0]?.project_id ?? null;

  return (
    <main className="min-h-dvh bg-black text-[#f5f5f5]">
      <DashboardSidebar />
      <section className="ml-[96px] min-h-dvh py-8 pr-8 pb-12 max-[900px]:py-6 max-[900px]:pr-5 max-[900px]:pb-10 max-[560px]:ml-[84px] max-[560px]:px-3 max-[560px]:py-5">
        <div className="w-full">
          <header className="flex items-end justify-between gap-8 max-[700px]:items-start max-[700px]:flex-col max-[700px]:gap-4">
            <div>
              <span className="text-xs text-[#5b5b5b]">
                {projectContext?.company?.company_name || "Workspace"} / Activity
              </span>
              <h1 className="mt-3 font-[var(--font-bricolage)] text-[clamp(32px,3vw,44px)] leading-[1.1] tracking-[-0.02em]">
                Activity
              </h1>
              <p className="mt-2 text-sm text-[#b4b4b4]">
                Every relationship. One clear next step.
              </p>
            </div>
            <label className="flex w-60 flex-col gap-1.5 max-[700px]:w-full">
              <span className="text-[10px] text-[#777a79]">Project</span>
              <span className="relative">
                <select
                  aria-label="Filter activity by project"
                  className="h-10 w-full cursor-pointer appearance-none rounded-[9px] border border-[#303231] bg-[#151716] pr-9 pl-3 text-[11px] text-[#e9ebe9] outline-none transition focus-visible:border-[#2aa284] focus-visible:ring-2 focus-visible:ring-[#2aa284]/15 disabled:cursor-default disabled:opacity-50"
                  disabled={contextLoading || projects.length === 0}
                  onChange={(event) => setSelectedProjectId(event.target.value)}
                  value={selectedProjectId ?? ""}
                >
                  {projectContext?.can_view_all_projects && (
                    <option value="all">All projects</option>
                  )}
                  {projects.map((project) => (
                    <option key={project.project_id} value={project.project_id}>
                      {project.project_name} · {project.project_code}
                    </option>
                  ))}
                  {!contextLoading && projects.length === 0 && (
                    <option value="">No projects available</option>
                  )}
                </select>
                <ChevronDown
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-[#9a9d9b]"
                  strokeWidth={1.8}
                />
              </span>
            </label>
          </header>

          <section className="mt-8 overflow-visible">
            <div className="flex min-h-[54px] items-stretch justify-between rounded-t-2xl border border-[#2c2c2c] bg-[#191919] px-4 max-[650px]:px-2">
              <div
                aria-label="Activity categories"
                className="flex min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                role="tablist"
              >
                {tabs.map((item) => (
                  <button
                    aria-selected={tab === item.id}
                    className={`relative h-[53px] min-w-[108px] shrink-0 border-0 bg-transparent px-4 font-[var(--font-bricolage)] text-sm font-semibold transition after:absolute after:right-1/2 after:bottom-0 after:h-0.5 after:translate-x-1/2 after:bg-[#2aa284] after:transition-all ${
                      tab === item.id
                        ? "text-[#f3f3f3] after:w-7"
                        : "text-[#939694] after:w-0 hover:text-[#d8dad9]"
                    }`}
                    key={item.id}
                    onClick={() => setTab(item.id)}
                    role="tab"
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div
                className="relative ml-4 flex shrink-0 items-center gap-2 border-l border-[#303030] pl-4 max-[650px]:ml-2 max-[650px]:gap-1.5 max-[650px]:pl-2"
                ref={toolsRef}
              >
                <div className="relative">
                  <ToolButton
                    active={dateRange !== "all" || openTool === "calendar"}
                    label="Choose date range"
                    onClick={() =>
                      setOpenTool(openTool === "calendar" ? null : "calendar")
                    }
                  >
                    <CalendarDays aria-hidden className="size-3.5" strokeWidth={1.8} />
                  </ToolButton>
                  {openTool === "calendar" && (
                    <Popup>
                      <p className="px-3 pt-1.5 pb-2 text-[9px] font-semibold tracking-[0.1em] text-[#747776] uppercase">
                        Date range
                      </p>
                      {dateRanges.map((option) => (
                        <MenuOption
                          active={dateRange === option.id}
                          key={option.id}
                          onClick={() => {
                            setDateRange(option.id);
                            setOpenTool(null);
                          }}
                        >
                          {option.label}
                        </MenuOption>
                      ))}
                    </Popup>
                  )}
                </div>
                <div className="relative">
                  <ToolButton
                    active={filter !== "all" || openTool === "filter"}
                    label="Filter activity"
                    onClick={() =>
                      setOpenTool(openTool === "filter" ? null : "filter")
                    }
                  >
                    <Funnel aria-hidden className="size-3.5" strokeWidth={1.8} />
                    {activeFilterCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-[#2aa284] text-[8px] font-semibold text-white">
                        {activeFilterCount}
                      </span>
                    )}
                  </ToolButton>
                  {openTool === "filter" && (
                    <Popup>
                      <div className="flex items-center justify-between px-3 pt-1.5 pb-2">
                        <p className="text-[9px] font-semibold tracking-[0.1em] text-[#747776] uppercase">
                          Activity type
                        </p>
                        {filter !== "all" && (
                          <button
                            aria-label="Clear activity filter"
                            className="border-0 bg-transparent text-[#7dcfb2] hover:text-white"
                            onClick={() => setFilter("all")}
                            type="button"
                          >
                            <X aria-hidden className="size-3" />
                          </button>
                        )}
                      </div>
                      {filterOptions.map((option) => (
                        <MenuOption
                          active={filter === option.id}
                          key={option.id}
                          onClick={() => {
                            setFilter(option.id);
                            setOpenTool(null);
                          }}
                        >
                          {option.label}
                        </MenuOption>
                      ))}
                    </Popup>
                  )}
                </div>
                <div className="relative">
                  <ToolButton
                    active={sort === "oldest" || openTool === "sort"}
                    label="Sort activity"
                    onClick={() =>
                      setOpenTool(openTool === "sort" ? null : "sort")
                    }
                  >
                    <ListFilter aria-hidden className="size-3.5" strokeWidth={1.8} />
                  </ToolButton>
                  {openTool === "sort" && (
                    <Popup>
                      <p className="px-3 pt-1.5 pb-2 text-[9px] font-semibold tracking-[0.1em] text-[#747776] uppercase">
                        Sort activity
                      </p>
                      <MenuOption
                        active={sort === "newest"}
                        onClick={() => {
                          setSort("newest");
                          setOpenTool(null);
                        }}
                      >
                        Newest first
                      </MenuOption>
                      <MenuOption
                        active={sort === "oldest"}
                        onClick={() => {
                          setSort("oldest");
                          setOpenTool(null);
                        }}
                      >
                        Oldest first
                      </MenuOption>
                    </Popup>
                  )}
                </div>
              </div>
            </div>

            <div
              className={`min-h-[min(763px,calc(100dvh-245px))] overflow-hidden rounded-b-2xl border-x border-b border-[#2c2c2c] bg-[#080808] ${
                tab === "activity" ? "px-4 py-6" : ""
              }`}
            >
              {tab === "calls" ? (
                <CallsView
                  creationProjectId={creationProjectId}
                  projectId={selectedProjectId}
                  sort={sort}
                />
              ) : tab === "email" ? (
                <EmailView
                  creationProjectId={creationProjectId}
                  initialCompose={initialEmailCompose}
                  onInitialComposeConsumed={() =>
                    setInitialEmailCompose(null)
                  }
                  projectId={selectedProjectId}
                  sort={sort}
                />
              ) : tab === "tasks" ? (
                <TasksView
                  creationProjectId={creationProjectId}
                  projectId={selectedProjectId}
                  sort={sort}
                />
              ) : tab === "notes" ? (
                <NotesView
                  creationProjectId={creationProjectId}
                  projectId={selectedProjectId}
                  sort={sort}
                />
              ) : loading ? (
                <div aria-label="Loading activity" className="space-y-6">
                  {[0, 1, 2].map((group) => (
                    <div className="space-y-3" key={group}>
                      <div className="h-4 w-24 animate-pulse rounded bg-[#202221]" />
                      {[0, 1, 2].map((row) => (
                        <div className="flex gap-3" key={row}>
                          <div className="size-4 animate-pulse rounded-full bg-[#252827]" />
                          <div className="h-11 flex-1 animate-pulse rounded-lg bg-[#171918]" />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                  <span className="flex size-10 items-center justify-center rounded-full border border-[#543832] bg-[#291b18] text-[#df8d7b]">
                    <X aria-hidden className="size-4" />
                  </span>
                  <p className="mt-3 text-sm text-[#d6d8d7]">Activity unavailable</p>
                  <p className="mt-1 max-w-sm text-[11px] text-[#777a79]">{error}</p>
                  <button
                    className="mt-4 rounded-md border border-[#315f50] bg-[#1d3c32] px-3 py-2 text-[11px] text-[#ccefe2] transition hover:bg-[#285142]"
                    onClick={() => void loadActivities()}
                    type="button"
                  >
                    Try again
                  </button>
                </div>
              ) : groups.length === 0 ? (
                <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                  <span className="flex size-11 items-center justify-center rounded-full border border-[#2e3432] bg-[#161918] text-[#7f8582]">
                    <Clock3 aria-hidden className="size-[18px]" strokeWidth={1.7} />
                  </span>
                  <p className="mt-3 text-sm text-[#d6d8d7]">
                    No {tabs.find((item) => item.id === tab)?.label.toLowerCase()} yet
                  </p>
                  <p className="mt-1 max-w-sm text-[11px] text-[#707371]">
                    Activity will appear here as your team works with leads.
                  </p>
                </div>
              ) : (
                <>
                  <div className="sr-only" aria-live="polite">
                    Showing {filteredActivities.length} of {total} activities
                  </div>
                  {groups.map(([groupTitle, records]) => (
                    <TimelineGroup
                      activities={records}
                      key={`${tab}-${groupTitle}`}
                      title={groupTitle}
                    />
                  ))}
                </>
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
