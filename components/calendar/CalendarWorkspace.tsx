"use client";

import {
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  Filter,
  LoaderCircle,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  UserRound,
  UsersRound,
  Video,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";

type CalendarView = "day" | "week" | "month" | "year";
type AppointmentType = "call" | "meeting" | "site_visit" | "video" | "other";
type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "rescheduled"
  | "checked_in"
  | "cancelled"
  | "completed"
  | "no_show";
type AppointmentAction = "confirm" | "cancel" | "complete";

type Project = {
  project_id: number;
  project_name: string;
  project_code: string;
};

type ProjectContext = {
  company?: { company_name?: string };
  role_key?: string;
  can_view_all_projects?: boolean;
  projects?: Project[];
};

type Appointment = {
  appointment_id: string;
  project_id: number;
  project_name?: string | null;
  lead_id?: string | null;
  opportunity_id?: string | null;
  contact_id?: string | null;
  appointment_type: AppointmentType;
  title: string;
  description?: string | null;
  location?: string | null;
  meeting_url?: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: AppointmentStatus;
  organizer_user_id?: string | null;
  assigned_to_user_id?: string | null;
  assigned_to_team_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  assignee_first_name?: string | null;
  assignee_last_name?: string | null;
  organizer_first_name?: string | null;
  organizer_last_name?: string | null;
  assigned_team_name?: string | null;
  cancellation_reason?: string | null;
  reschedule_reason?: string | null;
};

type Lead = {
  lead_id: string;
  contact_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

type User = {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

type AppointmentDraft = {
  project_id: string;
  lead_id: string;
  appointment_type: AppointmentType;
  title: string;
  description: string;
  location: string;
  meeting_url: string;
  starts_at: string;
  ends_at: string;
  assigned_to_user_id: string;
  reason: string;
};

const HOUR_HEIGHT = 58;
const START_HOUR = 6;
const END_HOUR = 22;
const HOURS = Array.from(
  { length: END_HOUR - START_HOUR },
  (_, index) => START_HOUR + index,
);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TYPE_META: Record<
  AppointmentType,
  { label: string; Icon: LucideIcon; chip: string; dot: string }
> = {
  call: {
    label: "Call",
    Icon: Phone,
    chip: "border-[#2aa284]/45 bg-[#123b32] text-[#8ce6cf]",
    dot: "bg-[#36c6a4]",
  },
  meeting: {
    label: "Meeting",
    Icon: UsersRound,
    chip: "border-[#ff6fa2]/45 bg-[#44202f] text-[#ffb5cf]",
    dot: "bg-[#ff6fa2]",
  },
  site_visit: {
    label: "Site visit",
    Icon: MapPin,
    chip: "border-[#d89a3d]/45 bg-[#3a2a14] text-[#f5c97b]",
    dot: "bg-[#e1a145]",
  },
  video: {
    label: "Video",
    Icon: Video,
    chip: "border-[#8c72ee]/45 bg-[#292047] text-[#c7b9ff]",
    dot: "bg-[#9479f5]",
  },
  other: {
    label: "Other",
    Icon: CalendarClock,
    chip: "border-[#5798d6]/45 bg-[#172f45] text-[#acd5fb]",
    dot: "bg-[#62a7e8]",
  },
};

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  rescheduled: "Rescheduled",
  checked_in: "Checked in",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
};

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function endOfDay(value: Date) {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
    23,
    59,
    59,
    999,
  );
}

function startOfWeek(value: Date) {
  const date = startOfDay(value);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function toDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function toLocalInput(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatTime(value: Date | string) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

function formatDate(value: Date | string, withYear = true) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(typeof value === "string" ? new Date(value) : value);
}

function formatHour(hour: number) {
  const date = new Date(2026, 0, 1, hour);
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric" }).format(date);
}

function fullName(
  first?: string | null,
  last?: string | null,
  fallback = "Unassigned",
) {
  return [first, last].filter(Boolean).join(" ") || fallback;
}

function appointmentOwner(appointment: Appointment) {
  return fullName(
    appointment.assignee_first_name ?? appointment.organizer_first_name,
    appointment.assignee_last_name ?? appointment.organizer_last_name,
  );
}

function dateRangeFor(view: CalendarView, cursor: Date) {
  if (view === "day") {
    return { from: startOfDay(cursor), to: endOfDay(cursor) };
  }
  if (view === "week") {
    const from = startOfWeek(cursor);
    return { from, to: endOfDay(addDays(from, 6)) };
  }
  if (view === "year") {
    return {
      from: new Date(cursor.getFullYear(), 0, 1),
      to: endOfDay(new Date(cursor.getFullYear(), 11, 31)),
    };
  }
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const from = startOfWeek(first);
  return { from, to: endOfDay(addDays(from, 41)) };
}

function blankDraft(projectId: string, startsAt?: Date): AppointmentDraft {
  const start = startsAt ?? new Date(Date.now() + 60 * 60 * 1000);
  start.setMinutes(start.getMinutes() < 30 ? 30 : 0, 0, 0);
  if (start.getMinutes() === 0) start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    project_id: projectId,
    lead_id: "",
    appointment_type: "meeting",
    title: "",
    description: "",
    location: "",
    meeting_url: "",
    starts_at: toLocalInput(start),
    ends_at: toLocalInput(end),
    assigned_to_user_id: "",
    reason: "Schedule updated from the calendar",
  };
}

function draftFromAppointment(appointment: Appointment): AppointmentDraft {
  return {
    project_id: String(appointment.project_id),
    lead_id: appointment.lead_id ?? "",
    appointment_type: appointment.appointment_type,
    title: appointment.title,
    description: appointment.description ?? "",
    location: appointment.location ?? "",
    meeting_url: appointment.meeting_url ?? "",
    starts_at: toLocalInput(appointment.starts_at),
    ends_at: toLocalInput(appointment.ends_at),
    assigned_to_user_id: appointment.assigned_to_user_id ?? "",
    reason:
      appointment.reschedule_reason ?? "Schedule updated from the calendar",
  };
}

function eventRangeLabel(appointment: Appointment) {
  return `${formatTime(appointment.starts_at)} – ${formatTime(appointment.ends_at)}`;
}

function eventTop(appointment: Appointment) {
  const date = new Date(appointment.starts_at);
  return (
    ((date.getHours() * 60 + date.getMinutes() - START_HOUR * 60) / 60) *
    HOUR_HEIGHT
  );
}

function eventHeight(appointment: Appointment) {
  const duration = Math.max(
    30,
    (new Date(appointment.ends_at).getTime() -
      new Date(appointment.starts_at).getTime()) /
      60_000,
  );
  return Math.max(28, (duration / 60) * HOUR_HEIGHT - 3);
}

function CalendarEvent({
  appointment,
  compact = false,
  onOpen,
}: {
  appointment: Appointment;
  compact?: boolean;
  onOpen: (appointment: Appointment) => void;
}) {
  const meta = TYPE_META[appointment.appointment_type];
  const Icon = meta.Icon;
  const completed = appointment.status === "completed";
  const terminal =
    completed ||
    ["cancelled", "no_show", "checked_in"].includes(appointment.status);
  return (
    <button
      className={`group/event flex w-full items-start gap-1.5 overflow-hidden rounded-[5px] border px-2 text-left shadow-sm transition duration-150 ${
        terminal
          ? "cursor-default"
          : "cursor-grab hover:-translate-y-px hover:brightness-110 active:cursor-grabbing"
      } ${
        completed ? "border-[#3b403d] bg-[#222624] text-[#9ca29e]" : meta.chip
      } ${
        compact ? "h-[24px] py-1" : "h-full py-1.5"
      } ${["cancelled", "no_show"].includes(appointment.status) ? "opacity-45 line-through" : ""}`}
      draggable={!terminal}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(appointment);
      }}
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
          "text/appointment-id",
          appointment.appointment_id,
        );
      }}
      title={`${appointment.title} · ${eventRangeLabel(appointment)}`}
      type="button"
    >
      <span
        className={`mt-0.5 h-[calc(100%-4px)] w-0.5 shrink-0 rounded-full ${completed ? "bg-[#737a76]" : meta.dot}`}
      />
      {!compact && (
        <Icon aria-hidden className="mt-0.5 size-3 shrink-0" strokeWidth={2} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10px] leading-3 font-semibold">
          {appointment.title}
        </span>
        {!compact && (
          <span className="mt-0.5 block truncate text-[9px] leading-3 opacity-75">
            {eventRangeLabel(appointment)}
          </span>
        )}
      </span>
    </button>
  );
}

export function CalendarWorkspace() {
  const router = useRouter();
  const filterRef = useRef<HTMLDivElement>(null);
  const [context, setContext] = useState<ProjectContext | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [view, setView] = useState<CalendarView>("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [opportunityFilter, setOpportunityFilter] = useState<string | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [composerMode, setComposerMode] = useState<
    "create" | "edit" | "reschedule" | null
  >(null);
  const [draft, setDraft] = useState<AppointmentDraft>(() => blankDraft(""));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pendingAction, setPendingAction] = useState<{
    appointment: Appointment;
    action: AppointmentAction;
  } | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const actionInFlightRef = useRef(false);

  const projects = useMemo(() => context?.projects ?? [], [context?.projects]);
  const range = useMemo(() => dateRangeFor(view, cursor), [cursor, view]);

  useEffect(() => {
    const task = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const requestedView = params.get("view");
      if (["day", "week", "month", "year"].includes(requestedView ?? ""))
        setView(requestedView as CalendarView);
      const requestedDate = params.get("date");
      if (requestedDate) {
        const date = new Date(`${requestedDate}T12:00:00`);
        if (!Number.isNaN(date.getTime())) setCursor(date);
      }
      const requestedOpportunity = params.get("opportunity_id");
      if (requestedOpportunity) setOpportunityFilter(requestedOpportunity);
    }, 0);
    return () => window.clearTimeout(task);
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
        const available = body.projects ?? [];
        const saved = window.localStorage.getItem("sthyra-project-id");
        const initial =
          saved &&
          (saved === "all"
            ? body.can_view_all_projects
            : available.some((project) => String(project.project_id) === saved))
            ? saved
            : body.can_view_all_projects
              ? "all"
              : available[0]
                ? String(available[0].project_id)
                : "";
        setContext(body);
        setSelectedProjectId(initial);
        if (!initial)
          setError("No active projects are available for your account.");
      } catch (cause) {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to load calendar context.",
        );
        setLoading(false);
      }
    }
    void loadContext();
    return () => {
      active = false;
    };
  }, [router]);

  const loadAppointments = useCallback(async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: "100",
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      });
      if (selectedProjectId !== "all")
        params.set("project_id", selectedProjectId);
      if (opportunityFilter) params.set("opportunity_id", opportunityFilter);
      const response = await fetchWithSession(
        `/api/appointments?${params.toString()}`,
        {
          cache: "no-store",
        },
      );
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) throw new Error(await getApiError(response));
      const body = (await response.json()) as { appointments?: Appointment[] };
      setAppointments(body.appointments ?? []);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to retrieve appointments.",
      );
    } finally {
      setLoading(false);
    }
  }, [opportunityFilter, range.from, range.to, router, selectedProjectId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadAppointments(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadAppointments]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    window.localStorage.setItem("sthyra-project-id", selectedProjectId);
    const projectId =
      selectedProjectId === "all"
        ? projects[0]?.project_id
        : Number(selectedProjectId);
    if (!projectId) return;
    let active = true;
    async function loadReferences() {
      const [leadResponse, userResponse] = await Promise.all([
        fetchWithSession(`/api/leads?project_id=${projectId}&limit=100`, {
          cache: "no-store",
        }),
        fetchWithSession("/api/appointments/options", { cache: "no-store" }),
      ]);
      if (!active) return;
      if (leadResponse.ok) {
        const body = (await leadResponse.json()) as { leads?: Lead[] };
        setLeads(body.leads ?? []);
      }
      if (userResponse.ok) {
        const body = (await userResponse.json()) as { users?: User[] };
        setUsers(body.users ?? []);
      }
    }
    void loadReferences();
    return () => {
      active = false;
    };
  }, [projects, selectedProjectId]);

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!filterRef.current?.contains(event.target as Node))
        setFiltersOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setFiltersOpen(false);
      setComposerMode(null);
      setSelected(null);
      setPendingAction(null);
      setActionReason("");
      setActionError(null);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  const visibleAppointments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return appointments.filter((appointment) => {
      const ownerId =
        appointment.assigned_to_user_id ?? appointment.organizer_user_id ?? "";
      return (
        (ownerFilter === "all" || ownerId === ownerFilter) &&
        (typeFilter === "all" || appointment.appointment_type === typeFilter) &&
        (statusFilter === "all" || appointment.status === statusFilter) &&
        (!normalized ||
          appointment.title.toLowerCase().includes(normalized) ||
          (appointment.location ?? "").toLowerCase().includes(normalized) ||
          fullName(appointment.first_name, appointment.last_name, "")
            .toLowerCase()
            .includes(normalized))
      );
    });
  }, [appointments, ownerFilter, query, statusFilter, typeFilter]);

  const activeFilterCount =
    Number(ownerFilter !== "all") +
    Number(typeFilter !== "all") +
    Number(statusFilter !== "all") +
    Number(Boolean(opportunityFilter));

  function openCreate(startsAt?: Date) {
    const projectId =
      selectedProjectId === "all"
        ? String(projects[0]?.project_id ?? "")
        : selectedProjectId;
    setDraft(blankDraft(projectId, startsAt));
    setSelected(null);
    setComposerMode("create");
  }

  function openEdit(appointment: Appointment, mode: "edit" | "reschedule") {
    setDraft(draftFromAppointment(appointment));
    setSelected(appointment);
    setComposerMode(mode);
  }

  function enrichAppointment(appointment: Appointment) {
    const lead = leads.find((item) => item.lead_id === appointment.lead_id);
    const project = projects.find(
      (item) => item.project_id === appointment.project_id,
    );
    const owner = users.find(
      (item) =>
        item.user_id ===
        (appointment.assigned_to_user_id ?? appointment.organizer_user_id),
    );
    return {
      ...appointment,
      project_name: appointment.project_name ?? project?.project_name ?? null,
      first_name: appointment.first_name ?? lead?.first_name ?? null,
      last_name: appointment.last_name ?? lead?.last_name ?? null,
      assignee_first_name:
        appointment.assignee_first_name ??
        (appointment.assigned_to_user_id ? owner?.first_name : null) ??
        null,
      assignee_last_name:
        appointment.assignee_last_name ??
        (appointment.assigned_to_user_id ? owner?.last_name : null) ??
        null,
      organizer_first_name:
        appointment.organizer_first_name ?? owner?.first_name ?? null,
      organizer_last_name:
        appointment.organizer_last_name ?? owner?.last_name ?? null,
    };
  }

  async function submitAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.project_id || !draft.title.trim()) {
      toast.error("Project and title are required.");
      return;
    }
    const start = new Date(draft.starts_at);
    const end = new Date(draft.ends_at);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      toast.error("End time must be after the start time.");
      return;
    }
    setSaving(true);
    try {
      let url = "/api/appointments";
      let method = "POST";
      let payload: Record<string, unknown> = {
        project_id: Number(draft.project_id),
        lead_id: draft.lead_id || null,
        appointment_type: draft.appointment_type,
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        location: draft.location.trim() || null,
        meeting_url: draft.meeting_url.trim() || null,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
        assigned_to_user_id: draft.assigned_to_user_id || null,
      };
      const isSiteVisit =
        draft.appointment_type === "site_visit" ||
        selected?.appointment_type === "site_visit";
      if (isSiteVisit) {
        url = "/api/site-visits";
        delete payload.appointment_type;
      }
      if (composerMode === "edit" && selected) {
        url = isSiteVisit
          ? `/api/site-visits/${selected.appointment_id}`
          : `/api/appointments/${selected.appointment_id}`;
        method = "PATCH";
        if (isSiteVisit) {
          delete payload.project_id;
          delete payload.lead_id;
          delete payload.starts_at;
          delete payload.ends_at;
        }
      }
      if (composerMode === "reschedule" && selected) {
        url = isSiteVisit
          ? `/api/site-visits/${selected.appointment_id}/reschedule`
          : `/api/appointments/${selected.appointment_id}/reschedule`;
        payload = {
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          reason: draft.reason.trim() || "Schedule updated from the calendar",
        };
      }
      const response = await fetchWithSession(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const body = (await response.json()) as {
        appointment?: Appointment;
        site_visit?: Appointment;
      };
      const savedAppointment = body.appointment ?? body.site_visit;
      toast.success(
        composerMode === "create"
          ? "Appointment created"
          : composerMode === "reschedule"
            ? "Appointment rescheduled"
            : "Appointment updated",
      );
      setComposerMode(null);
      if (savedAppointment) {
        setSelected((current) =>
          enrichAppointment(
            current ? { ...current, ...savedAppointment } : savedAppointment,
          ),
        );
      }
      await loadAppointments();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Unable to save appointment.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function runAction(
    appointment: Appointment,
    action: AppointmentAction,
    reason = "",
  ) {
    if (actionInFlightRef.current) return;
    if (action === "cancel" && !reason.trim()) {
      setActionError("Add a cancellation reason before continuing.");
      return;
    }
    actionInFlightRef.current = true;
    setActionError(null);
    setSaving(true);
    try {
      const response = await fetchWithSession(
        appointment.appointment_type === "site_visit"
          ? `/api/site-visits/${appointment.appointment_id}/${action}`
          : `/api/appointments/${appointment.appointment_id}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
        },
      );
      if (!response.ok) throw new Error(await getApiError(response));
      const body = (await response.json()) as {
        appointment?: Appointment;
        site_visit?: Appointment;
      };
      const updatedAppointment = body.appointment ?? body.site_visit;
      if (updatedAppointment) {
        setSelected(
          enrichAppointment({ ...appointment, ...updatedAppointment }),
        );
      }
      setPendingAction(null);
      setActionReason("");
      toast.success(
        `Appointment ${action === "complete" ? "completed" : `${action}ed`}`,
        { id: "appointment-action-result" },
      );
      await loadAppointments();
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : `Unable to ${action} appointment.`,
      );
    } finally {
      actionInFlightRef.current = false;
      setSaving(false);
    }
  }

  function requestAction(appointment: Appointment, action: AppointmentAction) {
    setPendingAction({ appointment, action });
    setActionReason("");
    setActionError(null);
  }

  async function rescheduleByDrop(appointmentId: string, target: Date) {
    const appointment = appointments.find(
      (item) => item.appointment_id === appointmentId,
    );
    if (
      !appointment ||
      ["cancelled", "completed", "no_show", "checked_in"].includes(
        appointment.status,
      )
    )
      return;
    const previousStart = new Date(appointment.starts_at);
    const duration =
      new Date(appointment.ends_at).getTime() -
      new Date(appointment.starts_at).getTime();
    const nextStart = new Date(target);
    const nextEnd = new Date(nextStart.getTime() + duration);
    const optimistic = {
      ...appointment,
      starts_at: nextStart.toISOString(),
      ends_at: nextEnd.toISOString(),
      status: "rescheduled" as const,
    };
    setAppointments((items) =>
      items.map((item) =>
        item.appointment_id === appointmentId ? optimistic : item,
      ),
    );
    setDraggingId(null);
    try {
      const response = await fetchWithSession(
        appointment.appointment_type === "site_visit"
          ? `/api/site-visits/${appointmentId}/reschedule`
          : `/api/appointments/${appointmentId}/reschedule`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            starts_at: nextStart.toISOString(),
            ends_at: nextEnd.toISOString(),
            reason: `Moved from ${previousStart.toLocaleString("en-IN")} using the calendar`,
          }),
        },
      );
      if (!response.ok) throw new Error(await getApiError(response));
      toast.success("Appointment moved");
      await loadAppointments();
    } catch (cause) {
      setAppointments((items) =>
        items.map((item) =>
          item.appointment_id === appointmentId ? appointment : item,
        ),
      );
      toast.error(
        cause instanceof Error ? cause.message : "Unable to move appointment.",
      );
    }
  }

  function dropOnDay(event: DragEvent, day: Date, hour?: number) {
    event.preventDefault();
    const appointmentId =
      event.dataTransfer.getData("text/appointment-id") || draggingId;
    if (!appointmentId) return;
    const source = appointments.find(
      (item) => item.appointment_id === appointmentId,
    );
    if (!source) return;
    const original = new Date(source.starts_at);
    const target = new Date(day);
    target.setHours(
      hour ?? original.getHours(),
      hour === undefined ? original.getMinutes() : 0,
      0,
      0,
    );
    void rescheduleByDrop(appointmentId, target);
  }

  function moveCursor(direction: -1 | 1) {
    const next = new Date(cursor);
    if (view === "day") next.setDate(next.getDate() + direction);
    if (view === "week") next.setDate(next.getDate() + direction * 7);
    if (view === "month") next.setMonth(next.getMonth() + direction, 1);
    if (view === "year") next.setFullYear(next.getFullYear() + direction, 0, 1);
    setCursor(next);
  }

  const heading = useMemo(() => {
    if (view === "day") {
      return new Intl.DateTimeFormat("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(cursor);
    }
    if (view === "week") {
      const weekStart = startOfWeek(cursor);
      const weekEnd = addDays(weekStart, 6);
      if (weekStart.getMonth() === weekEnd.getMonth()) {
        return `${weekStart.getDate()}–${weekEnd.getDate()} ${new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(weekEnd)}`;
      }
      return `${formatDate(weekStart)} – ${formatDate(weekEnd)}`;
    }
    if (view === "month") {
      return new Intl.DateTimeFormat("en-IN", {
        month: "long",
        year: "numeric",
      }).format(cursor);
    }
    return String(cursor.getFullYear());
  }, [cursor, view]);

  const resetLabel =
    view === "day"
      ? "Today"
      : view === "week"
        ? "This week"
        : view === "month"
          ? "This month"
          : "This year";
  const yearOptions = useMemo(() => {
    const presentYear = new Date().getFullYear();
    return Array.from(
      new Set([
        ...Array.from({ length: 13 }, (_, index) => presentYear - 6 + index),
        cursor.getFullYear(),
      ]),
    ).sort((left, right) => left - right);
  }, [cursor]);

  return (
    <main className="h-dvh overflow-hidden bg-black text-[#f5f5f5]">
      <DashboardSidebar />
      <section className="ml-[96px] h-dvh overflow-hidden pt-6 pr-6 max-[900px]:pt-5 max-[900px]:pr-4 max-[560px]:ml-[84px] max-[560px]:px-3 max-[560px]:pt-4">
        <div className="flex h-full min-h-0 w-full flex-col">
          <header className="flex shrink-0 items-end justify-between gap-6 max-[900px]:items-start max-[900px]:flex-col max-[900px]:gap-4">
            <div>
              <span className="text-xs text-[#5b5b5b]">
                {context?.company?.company_name || "Workspace"} / Calendar
              </span>
              <h1 className="mt-3 font-[var(--font-bricolage)] text-[clamp(32px,3vw,44px)] leading-[1.1] tracking-[-0.02em]">
                Calendar
              </h1>
              <p className="mt-2 text-sm text-[#b4b4b4]">
                Plan every call, meeting, and site visit in one place.
              </p>
            </div>
            <div className="flex items-end gap-2.5 max-[700px]:w-full max-[700px]:flex-wrap">
              <label className="flex w-60 flex-col gap-1.5 max-[700px]:min-w-[200px] max-[700px]:flex-1">
                <span className="text-[10px] text-[#777a79]">Project</span>
                <span className="relative">
                  <select
                    aria-label="Filter calendar by project"
                    className="h-10 w-full cursor-pointer appearance-none rounded-[9px] border border-[#303231] bg-[#151716] pr-9 pl-3 text-[11px] text-[#e9ebe9] outline-none transition focus-visible:border-[#2aa284] focus-visible:ring-2 focus-visible:ring-[#2aa284]/15"
                    onChange={(event) => {
                      setSelectedProjectId(event.target.value);
                      setOwnerFilter("all");
                    }}
                    value={selectedProjectId}
                  >
                    {context?.can_view_all_projects && (
                      <option value="all">All projects</option>
                    )}
                    {projects.map((project) => (
                      <option
                        key={project.project_id}
                        value={project.project_id}
                      >
                        {project.project_name} · {project.project_code}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-[#929694]"
                  />
                </span>
              </label>
              <button
                className="inline-flex h-10 items-center gap-2 rounded-[9px] bg-[#237e66] px-4 text-xs font-semibold text-white transition hover:bg-[#2a9277] disabled:opacity-50"
                onClick={() => openCreate()}
                type="button"
              >
                <Plus aria-hidden className="size-4" />
                New appointment
              </button>
            </div>
          </header>

          <section className="mt-5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[14px] border border-b-0 border-white/[0.1] bg-[#0b0d0c]">
            <div className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-white/[0.09] bg-[#151817] px-3 max-[780px]:items-start max-[780px]:flex-col max-[780px]:py-3">
              <div className="flex h-14 items-stretch gap-1 max-[780px]:h-10">
                {(["day", "week", "month", "year"] as CalendarView[]).map(
                  (item) => (
                    <button
                      className={`relative min-w-20 px-4 text-xs font-semibold capitalize outline-none transition hover:text-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#38b895]/45 ${
                        view === item ? "text-white" : "text-[#868a87]"
                      }`}
                      key={item}
                      onClick={() => setView(item)}
                      type="button"
                    >
                      {item}
                      {view === item && (
                        <span className="absolute right-7 bottom-0 left-7 h-0.5 rounded-full bg-[#2eb895]" />
                      )}
                    </button>
                  ),
                )}
              </div>
              <div className="flex items-center gap-2 max-[780px]:w-full max-[780px]:justify-end">
                <label className="relative max-[680px]:hidden">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[#777c79]"
                  />
                  <input
                    className="h-8 w-48 rounded-lg border border-white/[0.09] bg-[#111312] pr-3 pl-9 text-[11px] text-white outline-none placeholder:text-[#5f6461] focus:border-[#2aa284]"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search schedule"
                    value={query}
                  />
                </label>
                <div className="relative" ref={filterRef}>
                  <button
                    aria-expanded={filtersOpen}
                    aria-label="Calendar filters"
                    className={`relative flex size-8 items-center justify-center rounded-lg border transition ${
                      filtersOpen || activeFilterCount
                        ? "border-[#2aa284]/45 bg-[#18332c] text-[#63d4b7]"
                        : "border-white/[0.1] bg-[#272928] text-[#bfc3c0] hover:bg-[#303332]"
                    }`}
                    onClick={() => setFiltersOpen((open) => !open)}
                    type="button"
                  >
                    <Filter aria-hidden className="size-3.5" />
                    {activeFilterCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-[#2aa284] text-[8px] font-bold text-black">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>
                  {filtersOpen && (
                    <div className="absolute top-10 right-0 z-40 w-72 rounded-xl border border-white/[0.11] bg-[#151817] p-3 shadow-2xl">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">Filters</span>
                        <button
                          className="text-[10px] text-[#54c9ab] hover:text-[#77ddc3]"
                          onClick={() => {
                            setOwnerFilter("all");
                            setTypeFilter("all");
                            setStatusFilter("all");
                            setOpportunityFilter(null);
                            const url = new URL(window.location.href);
                            url.searchParams.delete("opportunity_id");
                            window.history.replaceState(null, "", url);
                          }}
                          type="button"
                        >
                          Clear all
                        </button>
                      </div>
                      <div className="mt-3 space-y-3">
                        <FilterSelect
                          label="Owner"
                          onChange={setOwnerFilter}
                          value={ownerFilter}
                        >
                          <option value="all">All owners</option>
                          {users.map((user) => (
                            <option key={user.user_id} value={user.user_id}>
                              {fullName(
                                user.first_name,
                                user.last_name,
                                user.email ?? "User",
                              )}
                            </option>
                          ))}
                        </FilterSelect>
                        <FilterSelect
                          label="Type"
                          onChange={setTypeFilter}
                          value={typeFilter}
                        >
                          <option value="all">All types</option>
                          {Object.entries(TYPE_META).map(([value, meta]) => (
                            <option key={value} value={value}>
                              {meta.label}
                            </option>
                          ))}
                        </FilterSelect>
                        <FilterSelect
                          label="Status"
                          onChange={setStatusFilter}
                          value={statusFilter}
                        >
                          <option value="all">All statuses</option>
                          {Object.entries(STATUS_LABEL).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </FilterSelect>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  aria-label="Refresh calendar"
                  className="flex size-8 items-center justify-center rounded-lg border border-white/[0.1] bg-[#272928] text-[#bfc3c0] transition hover:bg-[#303332] hover:text-white"
                  onClick={() => void loadAppointments()}
                  type="button"
                >
                  <RefreshCw
                    aria-hidden
                    className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                  />
                </button>
              </div>
            </div>

            <div className="flex min-h-[58px] shrink-0 items-center justify-between gap-4 border-b border-white/[0.08] px-4 py-3 max-[700px]:items-start max-[700px]:flex-col">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-lg font-semibold tracking-[-0.01em] text-[#f0f2f1]">
                  {heading}
                </h2>
                {opportunityFilter && (
                  <button
                    className="flex h-7 items-center gap-1.5 rounded-full border border-[#2aa284]/30 bg-[#18332c] px-2.5 text-[10px] font-semibold text-[#72d9bd]"
                    onClick={() => {
                      setOpportunityFilter(null);
                      const url = new URL(window.location.href);
                      url.searchParams.delete("opportunity_id");
                      window.history.replaceState(null, "", url);
                    }}
                    title="Show all appointments"
                    type="button"
                  >
                    Opportunity schedule <X className="size-3" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="relative mr-1">
                  <span className="sr-only">Calendar year</span>
                  <select
                    aria-label="Jump to year"
                    className="h-8 appearance-none rounded-lg border border-white/[0.09] bg-[#141615] pr-7 pl-3 text-[11px] font-medium text-[#d4d7d5] outline-none transition hover:bg-[#1d201e] focus-visible:border-[#3ab997] focus-visible:ring-2 focus-visible:ring-[#38b895]/15"
                    onChange={(event) => {
                      const next = new Date(cursor);
                      next.setFullYear(Number(event.target.value));
                      setCursor(next);
                    }}
                    value={cursor.getFullYear()}
                  >
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 text-[#777c79]"
                  />
                </label>
                <button
                  aria-label={`Previous ${view}`}
                  className="flex size-8 items-center justify-center rounded-lg border border-white/[0.09] bg-[#141615] text-[#aeb2af] outline-none transition hover:bg-[#1d201e] hover:text-white focus-visible:border-[#3ab997] focus-visible:ring-2 focus-visible:ring-[#38b895]/15"
                  onClick={() => moveCursor(-1)}
                  type="button"
                >
                  <ChevronLeft aria-hidden className="size-4" />
                </button>
                <button
                  className="h-8 rounded-lg border border-white/[0.09] bg-[#141615] px-3 text-[11px] font-medium text-[#d4d7d5] outline-none transition hover:bg-[#1d201e] focus-visible:border-[#3ab997] focus-visible:ring-2 focus-visible:ring-[#38b895]/15"
                  onClick={() => setCursor(new Date())}
                  type="button"
                >
                  {resetLabel}
                </button>
                <button
                  aria-label={`Next ${view}`}
                  className="flex size-8 items-center justify-center rounded-lg border border-white/[0.09] bg-[#141615] text-[#aeb2af] outline-none transition hover:bg-[#1d201e] hover:text-white focus-visible:border-[#3ab997] focus-visible:ring-2 focus-visible:ring-[#38b895]/15"
                  onClick={() => moveCursor(1)}
                  type="button"
                >
                  <ChevronRight aria-hidden className="size-4" />
                </button>
              </div>
            </div>

            {error ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
                <CircleAlert className="size-7 text-[#e18673]" />
                <p className="mt-3 text-sm text-[#d9dcda]">{error}</p>
                <button
                  className="mt-4 text-xs text-[#58cfb0]"
                  onClick={() => void loadAppointments()}
                  type="button"
                >
                  Try again
                </button>
              </div>
            ) : loading ? (
              <div className="flex min-h-0 flex-1 items-center justify-center text-[#737875]">
                <LoaderCircle className="size-5 animate-spin" />
              </div>
            ) : view === "month" ? (
              <MonthView
                appointments={visibleAppointments}
                cursor={cursor}
                draggingId={draggingId}
                onCreate={openCreate}
                onDrag={setDraggingId}
                onDrop={dropOnDay}
                onOpen={setSelected}
              />
            ) : view === "year" ? (
              <YearView
                appointments={visibleAppointments}
                cursor={cursor}
                onCreate={openCreate}
                onOpen={setSelected}
              />
            ) : (
              <TimeGrid
                appointments={visibleAppointments}
                cursor={cursor}
                days={view === "day" ? 1 : 7}
                draggingId={draggingId}
                onCreate={openCreate}
                onDrag={setDraggingId}
                onDrop={dropOnDay}
                onOpen={setSelected}
              />
            )}
          </section>
        </div>
      </section>

      {selected && !composerMode && (
        <AppointmentDrawer
          appointment={selected}
          now={now}
          saving={saving}
          onAction={requestAction}
          onClose={() => setSelected(null)}
          onEdit={(mode) => openEdit(selected, mode)}
        />
      )}

      {pendingAction && (
        <AppointmentActionDialog
          action={pendingAction.action}
          appointment={pendingAction.appointment}
          error={actionError}
          reason={actionReason}
          saving={saving}
          onClose={() => {
            if (saving) return;
            setPendingAction(null);
            setActionReason("");
            setActionError(null);
          }}
          onConfirm={() =>
            void runAction(
              pendingAction.appointment,
              pendingAction.action,
              actionReason,
            )
          }
          onReasonChange={(reason) => {
            setActionReason(reason);
            setActionError(null);
          }}
        />
      )}

      {composerMode && (
        <AppointmentComposer
          draft={draft}
          leads={leads}
          mode={composerMode}
          projects={projects}
          saving={saving}
          selected={selected}
          users={users}
          onChange={setDraft}
          onClose={() => setComposerMode(null)}
          onSubmit={submitAppointment}
        />
      )}
    </main>
  );
}

function FilterSelect({
  children,
  label,
  onChange,
  value,
}: {
  children: React.ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[9px] uppercase tracking-[0.12em] text-[#6f7471]">
        {label}
      </span>
      <span className="relative block">
        <select
          className="h-9 w-full appearance-none rounded-lg border border-white/[0.09] bg-[#0d0f0e] px-3 pr-8 text-[11px] text-[#dadddb] outline-none focus:border-[#2aa284]"
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3 -translate-y-1/2 text-[#777c79]" />
      </span>
    </label>
  );
}

function MonthView({
  appointments,
  cursor,
  draggingId,
  onCreate,
  onDrag,
  onDrop,
  onOpen,
}: {
  appointments: Appointment[];
  cursor: Date;
  draggingId: string | null;
  onCreate: (date: Date) => void;
  onDrag: (id: string | null) => void;
  onDrop: (event: DragEvent, date: Date) => void;
  onOpen: (appointment: Appointment) => void;
}) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const appointment of appointments) {
      const key = toDateKey(new Date(appointment.starts_at));
      map.set(key, [...(map.get(key) ?? []), appointment]);
    }
    return map;
  }, [appointments]);
  return (
    <div className="min-h-0 flex-1 overflow-auto [scrollbar-width:thin] [scrollbar-color:#303432_transparent]">
      <div className="min-w-[840px]">
        <div className="grid grid-cols-7 border-b border-white/[0.08] bg-[#0f1110]">
          {WEEKDAYS.map((day) => (
            <div
              className="px-2 py-2 text-center text-[10px] font-medium text-[#747976]"
              key={day}
            >
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const records = byDay.get(toDateKey(day)) ?? [];
            const today = sameDay(day, new Date());
            const outside = day.getMonth() !== cursor.getMonth();
            return (
              <div
                className={`group/day min-h-[124px] border-r border-b border-white/[0.07] p-2 transition ${
                  draggingId
                    ? "hover:bg-[#163128]/60"
                    : "hover:bg-white/[0.018]"
                } ${outside ? "bg-[#090b0a]" : "bg-[#0d0f0e]"}`}
                key={day.toISOString()}
                onClick={() => {
                  const startAt = new Date(day);
                  startAt.setHours(10, 0, 0, 0);
                  onCreate(startAt);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => onDrop(event, day)}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span
                    className={`flex size-6 items-center justify-center rounded-full text-[10px] ${
                      today
                        ? "bg-[#27896f] font-bold text-white"
                        : outside
                          ? "text-[#424744]"
                          : "text-[#9da19f]"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  <Plus className="size-3 text-transparent transition group-hover/day:text-[#717673]" />
                </div>
                <div className="space-y-1">
                  {records.slice(0, 3).map((appointment) => (
                    <div
                      key={appointment.appointment_id}
                      onDragEnd={() => onDrag(null)}
                      onDragStart={() => onDrag(appointment.appointment_id)}
                    >
                      <CalendarEvent
                        appointment={appointment}
                        compact
                        onOpen={onOpen}
                      />
                    </div>
                  ))}
                  {records.length > 3 && (
                    <button
                      className="px-1 text-[9px] text-[#6fcdb5] hover:text-[#91e4cf]"
                      onClick={(event) => event.stopPropagation()}
                      type="button"
                    >
                      +{records.length - 3} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function YearView({
  appointments,
  cursor,
  onCreate,
  onOpen,
}: {
  appointments: Appointment[];
  cursor: Date;
  onCreate: (date: Date) => void;
  onOpen: (appointment: Appointment) => void;
}) {
  const year = cursor.getFullYear();
  const months = Array.from(
    { length: 12 },
    (_, month) => new Date(year, month, 1),
  );
  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const appointment of appointments) {
      const key = toDateKey(new Date(appointment.starts_at));
      map.set(key, [...(map.get(key) ?? []), appointment]);
    }
    return map;
  }, [appointments]);

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 py-5 [scrollbar-width:thin] [scrollbar-color:#303432_transparent] max-[900px]:px-4">
      <div className="grid min-w-[760px] grid-cols-4 gap-x-8 gap-y-6 max-[1180px]:grid-cols-3">
        {months.map((month) => {
          const days = Array.from({ length: 42 }, (_, index) =>
            addDays(startOfWeek(month), index),
          );
          return (
            <section
              aria-label={new Intl.DateTimeFormat("en-IN", {
                month: "long",
              }).format(month)}
              key={month.toISOString()}
            >
              <h3 className="mb-3 text-[12px] font-semibold text-[#dfe2e0]">
                {new Intl.DateTimeFormat("en-IN", { month: "long" }).format(
                  month,
                )}
              </h3>
              <div className="grid grid-cols-7 gap-y-1">
                {WEEKDAYS.map((day) => (
                  <span
                    className="pb-1 text-center text-[8px] font-medium uppercase text-[#5f6461]"
                    key={day}
                  >
                    {day.slice(0, 1)}
                  </span>
                ))}
                {days.map((day) => {
                  const records = byDay.get(toDateKey(day)) ?? [];
                  const inMonth = day.getMonth() === month.getMonth();
                  const today = inMonth && sameDay(day, new Date());
                  return (
                    <button
                      aria-label={`${formatDate(day)}${records.length ? `, ${records.length} appointment${records.length === 1 ? "" : "s"}` : ""}`}
                      className={`relative mx-auto flex size-7 items-center justify-center rounded-md text-[9px] outline-none transition focus-visible:ring-2 focus-visible:ring-[#48c5a3]/50 ${
                        today
                          ? "bg-[#2b9a7c] font-bold text-white"
                          : inMonth
                            ? "text-[#b6bbb8] hover:bg-white/[0.07] hover:text-white"
                            : "pointer-events-none text-transparent"
                      }`}
                      disabled={!inMonth}
                      key={day.toISOString()}
                      onClick={() => {
                        if (records[0]) {
                          onOpen(records[0]);
                          return;
                        }
                        const startAt = new Date(day);
                        startAt.setHours(10, 0, 0, 0);
                        onCreate(startAt);
                      }}
                      type="button"
                    >
                      {day.getDate()}
                      {records.length > 0 && !today && (
                        <span
                          className={`absolute bottom-0.5 size-0.5 rounded-full ${
                            records[0].status === "completed"
                              ? "bg-[#737a76]"
                              : TYPE_META[records[0].appointment_type].dot
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TimeGrid({
  appointments,
  cursor,
  days,
  draggingId,
  onCreate,
  onDrag,
  onDrop,
  onOpen,
}: {
  appointments: Appointment[];
  cursor: Date;
  days: 1 | 7;
  draggingId: string | null;
  onCreate: (date: Date) => void;
  onDrag: (id: string | null) => void;
  onDrop: (event: DragEvent, date: Date, hour?: number) => void;
  onOpen: (appointment: Appointment) => void;
}) {
  const first = days === 7 ? startOfWeek(cursor) : startOfDay(cursor);
  const dates = Array.from({ length: days }, (_, index) =>
    addDays(first, index),
  );
  const now = new Date();
  const nowTop =
    ((now.getHours() * 60 + now.getMinutes() - START_HOUR * 60) / 60) *
    HOUR_HEIGHT;
  return (
    <div className="min-h-0 flex-1 overflow-auto [scrollbar-width:thin] [scrollbar-color:#303432_transparent]">
      <div className={days === 7 ? "min-w-[920px]" : "min-w-[620px]"}>
        <div
          className="sticky top-0 z-20 grid border-b border-white/[0.08] bg-[#0d0f0e]/95 backdrop-blur"
          style={{
            gridTemplateColumns: `64px repeat(${days}, minmax(0, 1fr))`,
          }}
        >
          <div className="border-r border-white/[0.07]" />
          {dates.map((date) => {
            const today = sameDay(date, now);
            return (
              <div
                className="border-r border-white/[0.07] px-2 py-2 text-center"
                key={date.toISOString()}
              >
                <span className="text-[9px] uppercase tracking-[0.12em] text-[#666b68]">
                  {WEEKDAYS[date.getDay()]}
                </span>
                <span
                  className={`mx-auto mt-1 flex size-7 items-center justify-center rounded-full text-xs font-medium ${today ? "bg-[#27896f] text-white" : "text-[#c3c7c4]"}`}
                >
                  {date.getDate()}
                </span>
              </div>
            );
          })}
        </div>
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `64px repeat(${days}, minmax(0, 1fr))`,
          }}
        >
          <div className="border-r border-white/[0.07] bg-[#0a0c0b]">
            {HOURS.map((hour) => (
              <div
                className="relative border-b border-white/[0.06]"
                key={hour}
                style={{ height: HOUR_HEIGHT }}
              >
                <span className="absolute -top-1.5 right-2 text-[9px] text-[#646966]">
                  {formatHour(hour)}
                </span>
              </div>
            ))}
          </div>
          {dates.map((date) => {
            const records = appointments.filter((appointment) =>
              sameDay(new Date(appointment.starts_at), date),
            );
            return (
              <div
                className="relative border-r border-white/[0.07]"
                key={date.toISOString()}
              >
                {HOURS.map((hour) => (
                  <button
                    aria-label={`Create appointment on ${formatDate(date)} at ${formatHour(hour)}`}
                    className={`block w-full border-b border-white/[0.06] text-left transition ${draggingId ? "hover:bg-[#17342b]/70" : "hover:bg-white/[0.018]"}`}
                    key={hour}
                    onClick={() => {
                      const startAt = new Date(date);
                      startAt.setHours(hour, 0, 0, 0);
                      onCreate(startAt);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => onDrop(event, date, hour)}
                    style={{ height: HOUR_HEIGHT }}
                    type="button"
                  />
                ))}
                {records.map((appointment) => {
                  const top = eventTop(appointment);
                  if (top < -HOUR_HEIGHT || top > HOURS.length * HOUR_HEIGHT)
                    return null;
                  return (
                    <div
                      className="absolute right-1 left-1 z-10 transition-[top] duration-200"
                      key={appointment.appointment_id}
                      onDragEnd={() => onDrag(null)}
                      onDragStart={() => onDrag(appointment.appointment_id)}
                      style={{
                        top: Math.max(1, top),
                        height: eventHeight(appointment),
                      }}
                    >
                      <CalendarEvent
                        appointment={appointment}
                        onOpen={onOpen}
                      />
                    </div>
                  );
                })}
                {sameDay(date, now) &&
                  nowTop >= 0 &&
                  nowTop <= HOURS.length * HOUR_HEIGHT && (
                    <div
                      className="pointer-events-none absolute right-0 left-0 z-10 flex items-center"
                      style={{ top: nowTop }}
                    >
                      <span className="size-2 -translate-x-1/2 rounded-full bg-[#42c9a7]" />
                      <span className="h-px flex-1 bg-[#42c9a7]" />
                    </div>
                  )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AppointmentDrawer({
  appointment,
  now,
  saving,
  onAction,
  onClose,
  onEdit,
}: {
  appointment: Appointment;
  now: number;
  saving: boolean;
  onAction: (appointment: Appointment, action: AppointmentAction) => void;
  onClose: () => void;
  onEdit: (mode: "edit" | "reschedule") => void;
}) {
  const meta = TYPE_META[appointment.appointment_type];
  const Icon = meta.Icon;
  const terminal = ["cancelled", "completed", "no_show"].includes(
    appointment.status,
  );
  const overdue = !terminal && new Date(appointment.starts_at).getTime() < now;
  return (
    <div
      className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-[2px]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[430px] flex-col border-l border-white/[0.11] bg-[#101311] shadow-[-18px_0_50px_rgba(0,0,0,0.38)]">
        <div className="flex items-center justify-between border-b border-white/[0.09] px-6 py-5">
          <div>
            <span className="text-[10px] uppercase tracking-[0.13em] text-[#6f7471]">
              Appointment details
            </span>
            <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.02em] text-white">
              {appointment.title}
            </h2>
          </div>
          <button
            aria-label="Close appointment"
            className="flex size-8 items-center justify-center rounded-md text-[#999e9b] outline-none transition hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-[#38b895]/45"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`mt-5 inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-semibold ${meta.chip}`}
            >
              <Icon className="size-3" /> {meta.label}
            </span>
            <span className="mt-5 inline-flex h-7 items-center rounded-md border border-white/[0.1] bg-white/[0.035] px-2.5 text-[10px] text-[#b7bbb8]">
              {STATUS_LABEL[appointment.status]}
            </span>
            {overdue && (
              <span className="mt-5 inline-flex h-7 items-center rounded-md bg-[#3b211d] px-2.5 text-[10px] text-[#ed8b79]">
                Overdue
              </span>
            )}
          </div>

          <div className="mt-5 border-t border-white/[0.09] py-5">
            <DetailRow
              icon={Clock3}
              label="When"
              value={`${formatDate(appointment.starts_at)} · ${eventRangeLabel(appointment)}`}
            />
            <DetailRow
              icon={CalendarDays}
              label="Timezone"
              value={appointment.timezone}
            />
            <DetailRow
              icon={MapPin}
              label="Location"
              value={appointment.location || "No location added"}
            />
            {appointment.meeting_url && (
              <a
                className="mt-4 flex items-center gap-3 text-xs text-[#6bd6b9] hover:text-[#8be4cd]"
                href={appointment.meeting_url}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink className="size-4" /> Join meeting
              </a>
            )}
          </div>

          <div className="border-t border-white/[0.09] py-5">
            <DetailRow
              icon={UserRound}
              label="Lead / contact"
              value={fullName(
                appointment.first_name,
                appointment.last_name,
                "Not linked",
              )}
            />
            {appointment.lead_id && (
              <p className="-mt-1 mb-2 pl-7 font-mono text-[9px] text-[#606562]">
                Lead ID: {appointment.lead_id.slice(0, 8)}
              </p>
            )}
            <DetailRow
              icon={UsersRound}
              label="Owner"
              value={appointmentOwner(appointment)}
            />
            <DetailRow
              icon={CalendarClock}
              label="Project"
              value={
                appointment.project_name || `Project ${appointment.project_id}`
              }
            />
          </div>

          {appointment.description && (
            <div className="border-t border-white/[0.09] py-5">
              <span className="text-[9px] uppercase tracking-[0.12em] text-[#6f7471]">
                Notes
              </span>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#c5c9c6]">
                {appointment.description}
              </p>
            </div>
          )}
          {(appointment.reschedule_reason ||
            appointment.cancellation_reason) && (
            <div className="mb-5 border-l-2 border-[#bd8751] bg-[#211b15] px-3 py-2.5 text-xs leading-5 text-[#c4b6a6]">
              {appointment.reschedule_reason || appointment.cancellation_reason}
            </div>
          )}
        </div>
        <div className="border-t border-white/[0.09] bg-[#0d100e] p-4">
          {terminal ? (
            <div className="flex items-start gap-3 rounded-md border border-white/[0.08] bg-white/[0.025] px-3 py-3">
              {appointment.status === "completed" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#53c9a9]" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-[#dc806f]" />
              )}
              <div>
                <p className="text-xs font-medium text-[#d8dcda]">
                  This appointment is {appointment.status}.
                </p>
                <p className="mt-1 text-[10px] leading-4 text-[#777d79]">
                  Finished appointments are read-only and cannot be edited or
                  rescheduled.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/[0.11] bg-[#181b19] text-xs text-[#d9dcda] transition hover:bg-[#222623] disabled:opacity-40"
                disabled={saving}
                onClick={() => onEdit("edit")}
                type="button"
              >
                <Pencil className="size-3.5" /> Edit
              </button>
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/[0.11] bg-[#181b19] text-xs text-[#d9dcda] transition hover:bg-[#222623] disabled:opacity-40"
                disabled={saving}
                onClick={() => onEdit("reschedule")}
                type="button"
              >
                <RotateCcw className="size-3.5" /> Reschedule
              </button>
              {appointment.status !== "confirmed" && (
                <button
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#205b77] text-xs font-semibold text-white transition hover:bg-[#286f90] disabled:opacity-40"
                  disabled={saving}
                  onClick={() => onAction(appointment, "confirm")}
                  type="button"
                >
                  <Check className="size-3.5" /> Confirm
                </button>
              )}
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#237e66] text-xs font-semibold text-white transition hover:bg-[#2a9277] disabled:opacity-40"
                disabled={saving}
                onClick={() => onAction(appointment, "complete")}
                type="button"
              >
                <CheckCircle2 className="size-3.5" /> Complete
              </button>
              <button
                className="col-span-2 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#6e3028] bg-[#2b1714] text-xs text-[#ef9482] transition hover:bg-[#3a1d19] disabled:opacity-40"
                disabled={saving}
                onClick={() => onAction(appointment, "cancel")}
                type="button"
              >
                <XCircle className="size-3.5" /> Cancel appointment
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function AppointmentActionDialog({
  action,
  appointment,
  error,
  reason,
  saving,
  onClose,
  onConfirm,
  onReasonChange,
}: {
  action: AppointmentAction;
  appointment: Appointment;
  error: string | null;
  reason: string;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onReasonChange: (reason: string) => void;
}) {
  const content = {
    confirm: {
      title: "Confirm appointment",
      description:
        "Confirm that this appointment is accepted and remains on the schedule.",
      button: "Confirm appointment",
      buttonClass: "bg-[#205b77] hover:bg-[#286f90]",
      Icon: Check,
      iconClass: "bg-[#183244] text-[#8dc8ed]",
    },
    complete: {
      title: "Complete appointment",
      description:
        "Mark this appointment as finished. Completed appointments become read-only.",
      button: "Mark as completed",
      buttonClass: "bg-[#237e66] hover:bg-[#2a9277]",
      Icon: CheckCircle2,
      iconClass: "bg-[#17372e] text-[#68d4b6]",
    },
    cancel: {
      title: "Cancel appointment",
      description:
        "Cancel this appointment and keep the reason in its activity history.",
      button: "Cancel appointment",
      buttonClass: "bg-[#8f3e31] hover:bg-[#a6493a]",
      Icon: XCircle,
      iconClass: "bg-[#3a1e1a] text-[#ef8f7d]",
    },
  }[action];
  const Icon = content.Icon;

  return (
    <div
      aria-labelledby="appointment-action-title"
      aria-modal="true"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
      role="dialog"
    >
      <form
        className="w-full max-w-[440px] overflow-hidden rounded-xl border border-white/[0.12] bg-[#121513] shadow-[0_28px_90px_rgba(0,0,0,0.65)]"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${content.iconClass}`}
          >
            <Icon className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              className="text-base font-semibold tracking-[-0.01em] text-white"
              id="appointment-action-title"
            >
              {content.title}
            </h2>
            <p className="mt-1 text-[11px] leading-4 text-[#8e9490]">
              {content.description}
            </p>
          </div>
          <button
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-[#858b87] transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-5">
          <div className="rounded-lg border border-white/[0.08] bg-[#0d100e] px-3.5 py-3">
            <p className="truncate text-xs font-medium text-[#e2e5e3]">
              {appointment.title}
            </p>
            <p className="mt-1 text-[10px] text-[#747a76]">
              {formatDate(appointment.starts_at)} ·{" "}
              {eventRangeLabel(appointment)}
            </p>
          </div>

          {action === "cancel" && (
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[10px] font-medium text-[#aeb3b0]">
                Cancellation reason
              </span>
              <textarea
                autoFocus
                className="min-h-24 w-full resize-none rounded-lg border border-white/[0.1] bg-[#0b0d0c] px-3 py-2.5 text-xs leading-5 text-white outline-none placeholder:text-[#555b57] focus:border-[#b65b4b] focus:ring-2 focus:ring-[#b65b4b]/10"
                maxLength={5000}
                onChange={(event) => onReasonChange(event.target.value)}
                placeholder="Explain why this appointment is being cancelled"
                required
                value={reason}
              />
            </label>
          )}

          {error && (
            <div
              className="mt-4 flex items-start gap-2 rounded-lg border border-[#70342c] bg-[#2a1714] px-3 py-2.5 text-[11px] leading-4 text-[#f0a092]"
              role="alert"
            >
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.09] bg-[#0e110f] px-5 py-4">
          <button
            className="h-9 rounded-md border border-white/[0.11] bg-[#191c1a] px-4 text-xs text-[#d2d6d3] transition hover:bg-[#232724] disabled:opacity-40"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            Keep appointment
          </button>
          <button
            className={`inline-flex h-9 min-w-36 items-center justify-center gap-2 rounded-md px-4 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-45 ${content.buttonClass}`}
            disabled={saving || (action === "cancel" && !reason.trim())}
            type="submit"
          >
            {saving ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Icon className="size-3.5" />
            )}
            {saving ? "Saving…" : content.button}
          </button>
        </div>
      </form>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3 py-2 first:pt-0 last:pb-0">
      <Icon
        className="mt-0.5 size-4 shrink-0 text-[#777d79]"
        strokeWidth={1.7}
      />
      <div className="min-w-0">
        <span className="block text-[9px] uppercase tracking-[0.12em] text-[#646966]">
          {label}
        </span>
        <span className="mt-1 block break-words text-xs text-[#d6dad7]">
          {value}
        </span>
      </div>
    </div>
  );
}

function AppointmentComposer({
  draft,
  leads,
  mode,
  projects,
  saving,
  selected,
  users,
  onChange,
  onClose,
  onSubmit,
}: {
  draft: AppointmentDraft;
  leads: Lead[];
  mode: "create" | "edit" | "reschedule";
  projects: Project[];
  saving: boolean;
  selected: Appointment | null;
  users: User[];
  onChange: (draft: AppointmentDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const set = <K extends keyof AppointmentDraft>(
    key: K,
    value: AppointmentDraft[K],
  ) => onChange({ ...draft, [key]: value });
  const title =
    mode === "create"
      ? "New appointment"
      : mode === "reschedule"
        ? "Reschedule appointment"
        : "Edit appointment";
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[3px]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#121513] shadow-[0_28px_100px_rgba(0,0,0,0.65)]"
        onSubmit={onSubmit}
      >
        <div className="flex items-center justify-between border-b border-white/[0.09] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-[11px] text-[#737875]">
              {mode === "reschedule"
                ? selected?.title
                : "Connect it to a lead so the full history stays together."}
            </p>
          </div>
          <button
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-[#919693] hover:bg-white/[0.06] hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 [scrollbar-width:thin]">
          {mode !== "reschedule" && (
            <>
              <div className="grid grid-cols-2 gap-4 max-[620px]:grid-cols-1">
                <FormSelect
                  label="Project"
                  required
                  onChange={(value) => set("project_id", value)}
                  value={draft.project_id}
                >
                  <option value="">Select project</option>
                  {projects.map((project) => (
                    <option key={project.project_id} value={project.project_id}>
                      {project.project_name}
                    </option>
                  ))}
                </FormSelect>
                <FormSelect
                  label="Type"
                  required
                  onChange={(value) =>
                    set("appointment_type", value as AppointmentType)
                  }
                  value={draft.appointment_type}
                >
                  {Object.entries(TYPE_META).map(([value, meta]) => (
                    <option key={value} value={value}>
                      {meta.label}
                    </option>
                  ))}
                </FormSelect>
              </div>
              <FormInput
                label="Title"
                onChange={(value) => set("title", value)}
                placeholder="e.g. Tower 10 site visit"
                required
                value={draft.title}
              />
              <div className="grid grid-cols-2 gap-4 max-[620px]:grid-cols-1">
                <FormSelect
                  label="Linked lead"
                  onChange={(value) => set("lead_id", value)}
                  value={draft.lead_id}
                >
                  <option value="">No linked lead</option>
                  {leads.map((lead) => (
                    <option key={lead.lead_id} value={lead.lead_id}>
                      {fullName(
                        lead.first_name,
                        lead.last_name,
                        lead.email ?? "Lead",
                      )}
                    </option>
                  ))}
                </FormSelect>
                <FormSelect
                  label="Owner"
                  onChange={(value) => set("assigned_to_user_id", value)}
                  value={draft.assigned_to_user_id}
                >
                  <option value="">No assigned owner</option>
                  {users.map((user) => (
                    <option key={user.user_id} value={user.user_id}>
                      {fullName(
                        user.first_name,
                        user.last_name,
                        user.email ?? "User",
                      )}
                    </option>
                  ))}
                </FormSelect>
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-4 max-[620px]:grid-cols-1">
            <FormInput
              label="Starts"
              onChange={(value) => set("starts_at", value)}
              required
              type="datetime-local"
              value={draft.starts_at}
            />
            <FormInput
              label="Ends"
              onChange={(value) => set("ends_at", value)}
              required
              type="datetime-local"
              value={draft.ends_at}
            />
          </div>
          {mode === "reschedule" ? (
            <FormInput
              label="Reason"
              onChange={(value) => set("reason", value)}
              placeholder="Why is the schedule changing?"
              required
              value={draft.reason}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 max-[620px]:grid-cols-1">
                <FormInput
                  label="Location"
                  onChange={(value) => set("location", value)}
                  placeholder="Sales office, Tower 10…"
                  value={draft.location}
                />
                <FormInput
                  label="Meeting link"
                  onChange={(value) => set("meeting_url", value)}
                  placeholder="https://meet.google.com/…"
                  type="url"
                  value={draft.meeting_url}
                />
              </div>
              <label className="mt-4 block">
                <span className="mb-1.5 block text-[10px] font-medium text-[#929794]">
                  Description
                </span>
                <textarea
                  className="min-h-24 w-full resize-y rounded-[9px] border border-white/[0.1] bg-[#0b0d0c] px-3 py-2.5 text-xs leading-5 text-white outline-none placeholder:text-[#555a57] focus:border-[#2aa284] focus:ring-2 focus:ring-[#2aa284]/10"
                  onChange={(event) => set("description", event.target.value)}
                  placeholder="Agenda, preparation notes, or visit instructions"
                  value={draft.description}
                />
              </label>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-white/[0.09] bg-[#0f1210] px-5 py-4">
          <button
            className="h-9 rounded-lg border border-white/[0.11] bg-[#1a1d1b] px-4 text-xs text-[#d1d5d2] hover:bg-[#242724]"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex h-9 min-w-28 items-center justify-center gap-2 rounded-lg bg-[#237e66] px-4 text-xs font-semibold text-white hover:bg-[#2a9277] disabled:opacity-50"
            disabled={saving}
            type="submit"
          >
            {saving && <LoaderCircle className="size-3.5 animate-spin" />}
            {mode === "create"
              ? "Create"
              : mode === "reschedule"
                ? "Reschedule"
                : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FormInput({
  label,
  onChange,
  required,
  type = "text",
  value,
  placeholder,
}: {
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  value: string;
  placeholder?: string;
}) {
  return (
    <label className="mt-4 block">
      <span className="mb-1.5 block text-[10px] font-medium text-[#929794]">
        {label}
      </span>
      <input
        className="h-10 w-full rounded-[9px] border border-white/[0.1] bg-[#0b0d0c] px-3 text-xs text-white outline-none placeholder:text-[#555a57] focus:border-[#2aa284] focus:ring-2 focus:ring-[#2aa284]/10"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
      />
    </label>
  );
}

function FormSelect({
  children,
  label,
  onChange,
  required,
  value,
}: {
  children: React.ReactNode;
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
}) {
  return (
    <label className="mt-4 block">
      <span className="mb-1.5 block text-[10px] font-medium text-[#929794]">
        {label}
      </span>
      <span className="relative block">
        <select
          className="h-10 w-full appearance-none rounded-[9px] border border-white/[0.1] bg-[#0b0d0c] px-3 pr-9 text-xs text-white outline-none focus:border-[#2aa284] focus:ring-2 focus:ring-[#2aa284]/10"
          onChange={(event) => onChange(event.target.value)}
          required={required}
          value={value}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-[#7f8481]" />
      </span>
    </label>
  );
}
