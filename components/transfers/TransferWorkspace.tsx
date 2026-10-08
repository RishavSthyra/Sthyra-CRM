"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  FileCheck2,
  History,
  LoaderCircle,
  RefreshCw,
  Search,
  Send,
  X,
  XCircle,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";

type Project = {
  project_id: number;
  project_code: string;
  project_name: string;
};

type WorkspaceContext = {
  company?: { company_name?: string };
  can_view_all_projects?: boolean;
  projects?: Project[];
};

type CurrentUser = {
  user_id: string;
  team_id?: string | null;
};

type TransferStatus =
  | "draft"
  | "validated"
  | "submitted"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "expired"
  | "force_assigned";

type Transfer = {
  transfer_id: string;
  company_id: number;
  project_id: number;
  project_name: string;
  subject_type: "lead" | "opportunity";
  subject_name: string;
  lead_id?: string | null;
  opportunity_id?: string | null;
  from_owner_user_id?: string | null;
  from_team_id?: string | null;
  to_owner_user_id?: string | null;
  to_team_id?: string | null;
  checklist_template_id?: string | null;
  status: TransferStatus;
  reason?: string | null;
  notes?: string | null;
  rejection_reason?: string | null;
  validation_errors?: string[];
  requested_by: string;
  recipient_first_name?: string | null;
  recipient_last_name?: string | null;
  recipient_team_name?: string | null;
  requester_first_name?: string | null;
  requester_last_name?: string | null;
  expires_at?: string | null;
  submitted_at?: string | null;
  accepted_at?: string | null;
  rejected_at?: string | null;
  cancelled_at?: string | null;
  force_assigned_at?: string | null;
  created_at: string;
  updated_at: string;
};

type TransferDetail = Transfer & {
  recipient?: {
    user_id: string;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  } | null;
  recipient_team?: { team_id: string; team_name: string } | null;
  previous_owner?: {
    user_id: string;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  } | null;
  previous_team?: { team_id: string; team_name: string } | null;
  requester?: {
    user_id: string;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  } | null;
};

type ChecklistItem = {
  item_id: string;
  label: string;
  description?: string | null;
  is_required: boolean;
  is_completed: boolean;
  notes?: string | null;
  completed_at?: string | null;
  completed_by_user?: {
    first_name?: string | null;
    last_name?: string | null;
  } | null;
};

type TransferHistory = {
  history_id: string;
  action: string;
  from_status?: string | null;
  to_status: string;
  metadata?: Record<string, unknown>;
  performed_by_first_name?: string | null;
  performed_by_last_name?: string | null;
  created_at: string;
};

type EligibleUser = {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  team_id?: string | null;
  team_name?: string | null;
};

type EligibleTeam = {
  team_id: string;
  team_name: string;
  team_type?: string | null;
};

type TransferSubject = {
  subject_id: string;
  subject_name: string;
  email?: string | null;
  phone_number?: string | null;
  status: string;
  temperature?: string | null;
  stage_name?: string | null;
  current_owner_user_id?: string | null;
  current_team_id?: string | null;
  owner_first_name?: string | null;
  owner_last_name?: string | null;
  owner_team_name?: string | null;
  active_transfer_id?: string | null;
  active_transfer_status?: TransferStatus | null;
};

type ChecklistTemplate = {
  template_id: string;
  template_name: string;
  description?: string | null;
  item_count: number;
};

type TransferOptions = {
  subjects: TransferSubject[];
  users: EligibleUser[];
  teams: EligibleTeam[];
  templates: ChecklistTemplate[];
};

type DrawerTab = "overview" | "checklist" | "history";
type TransferAction =
  | "validate"
  | "submit"
  | "accept"
  | "reject"
  | "cancel"
  | "expire"
  | "force-assign";

const ACTIVE_STATUSES: TransferStatus[] = ["draft", "validated", "submitted"];
const RENDER_TIMESTAMP = Date.now();
const DEFAULT_TRANSFER_EXPIRY = new Date(
  RENDER_TIMESTAMP + 3 * 24 * 60 * 60 * 1000,
);

const fieldClass =
  "h-11 w-full rounded-[10px] border border-[#2c2c2c] bg-[#111] px-3.5 text-sm text-[#e8ece9] outline-none transition placeholder:text-[#666] focus:border-[#55c8a6]/60 disabled:opacity-50";
const selectClass = `${fieldClass} appearance-none pr-10`;

function name(
  first?: string | null,
  last?: string | null,
  fallback = "Unassigned",
) {
  return [first, last].filter(Boolean).join(" ") || fallback;
}

function label(value?: string | null) {
  return value
    ? value
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "—";
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

function toLocalDateTime(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function recipientLabel(transfer: Transfer) {
  return transfer.to_owner_user_id
    ? name(transfer.recipient_first_name, transfer.recipient_last_name)
    : (transfer.recipient_team_name ?? "Team recipient");
}

function statusTone(status: TransferStatus) {
  if (["accepted", "force_assigned"].includes(status))
    return "border-[#45ba91]/25 bg-[#14372c] text-[#79d6b6]";
  if (status === "submitted")
    return "border-[#699fd8]/25 bg-[#172c40] text-[#9bc8f1]";
  if (status === "validated")
    return "border-[#a88be8]/25 bg-[#29203f] text-[#c5b2f2]";
  if (["rejected", "cancelled", "expired"].includes(status))
    return "border-[#c96d65]/25 bg-[#3a201e] text-[#e99a93]";
  return "border-white/[0.1] bg-white/[0.045] text-[#aeb5b1]";
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithSession(url, { cache: "no-store", ...init });
  if (!response.ok) throw new Error(await getApiError(response));
  return (await response.json()) as T;
}

function Modal({
  children,
  description,
  onClose,
  title,
}: {
  children: ReactNode;
  description: string;
  onClose: () => void;
  title: string;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[90] grid place-items-center bg-black/75 p-4 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="dialog"
    >
      <section className="max-h-[calc(100dvh-32px)] w-full max-w-[620px] overflow-y-auto rounded-2xl border border-white/[0.13] bg-[#101411] shadow-[0_30px_100px_rgba(0,0,0,.72)]">
        <header className="flex items-start justify-between border-b border-white/[0.09] px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-[#7d8581]">{description}</p>
          </div>
          <button
            aria-label="Close"
            className="grid size-9 place-items-center text-[#87908b] hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X className="size-5" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function CreateTransferDrawer({
  subject,
  options,
  onClose,
  onCreated,
}: {
  subject: TransferSubject;
  options: TransferOptions;
  onClose: () => void;
  onCreated: (transfer: Transfer) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [recipientKind, setRecipientKind] = useState<"user" | "team">("user");
  const [recipientId, setRecipientId] = useState("");
  const [templateId, setTemplateId] = useState(
    options.templates[0]?.template_id ?? "",
  );
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [expiresAt, setExpiresAt] = useState(
    toLocalDateTime(DEFAULT_TRANSFER_EXPIRY),
  );

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const users = options.users.filter(
    (user) => user.user_id !== subject?.current_owner_user_id,
  );
  const teams = options.teams.filter(
    (team) => team.team_id !== subject?.current_team_id,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!recipientId) {
      toast.error("Select a recipient");
      return;
    }
    setBusy(true);
    try {
      const payload = await api<{ transfer: Transfer }>("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: subject.subject_id,
          [recipientKind === "user" ? "to_owner_user_id" : "to_team_id"]:
            recipientId,
          checklist_template_id: templateId || null,
          reason: reason.trim() || null,
          notes: notes.trim() || null,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      toast.success("Transfer draft created");
      window.dispatchEvent(new Event("notifications:changed"));
      await onCreated(payload.transfer);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Unable to create transfer",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        aria-label="Close transfer panel"
        className="fixed inset-0 z-[80] bg-black/75"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-modal="true"
        className="fixed inset-y-0 right-0 z-[90] flex w-full max-w-[620px] flex-col overflow-hidden border-l border-[#2c2c2c] bg-[#111] shadow-[-30px_0_90px_rgba(0,0,0,.6)] max-[560px]:max-w-full"
        role="dialog"
      >
        <header className="flex items-start justify-between bg-[#111] px-6 pt-6 pb-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.15em] text-[#69716d] uppercase">
              Transfer lead
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              {subject.subject_name}
            </h2>
            <p className="mt-1 text-sm text-[#7d8581]">
              {subject.email || "No email"} ·{" "}
              {subject.stage_name ?? label(subject.status)}
            </p>
          </div>
          <button
            aria-label="Close"
            className="grid size-9 place-items-center rounded-lg border border-[#2c2c2c] bg-[#191919] text-[#999] hover:bg-[#262626] hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X className="size-5" />
          </button>
        </header>

        <form
          className="flex-1 overflow-y-auto bg-[#0b0b0b] p-6"
          onSubmit={submit}
        >
          <section className="flex items-center justify-between gap-5 pb-3">
            <span className="text-[10px] tracking-[0.08em] text-[#68706c] uppercase">
              Current ownership
            </span>
            <p className="text-right text-sm font-medium text-[#dce1de]">
              {subject.owner_first_name || subject.owner_last_name
                ? name(subject.owner_first_name, subject.owner_last_name)
                : (subject.owner_team_name ?? "Unassigned")}
            </p>
          </section>

          <section className="pt-6">
            <h3 className="text-[10px] font-semibold tracking-[0.12em] text-[#68706c] uppercase">
              Destination
            </h3>
            <div className="mt-4 grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
              <label>
                <span className="mb-2 block text-xs text-[#9da5a1]">
                  Send to
                </span>
                <div className="relative">
                  <select
                    className={selectClass}
                    onChange={(event) => {
                      setRecipientKind(event.target.value as "user" | "team");
                      setRecipientId("");
                    }}
                    value={recipientKind}
                  >
                    <option value="user">Person</option>
                    <option value="team">Team</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-[#7f8883]" />
                </div>
              </label>
              <label>
                <span className="mb-2 block text-xs text-[#9da5a1]">
                  Recipient
                </span>
                <div className="relative">
                  <select
                    className={selectClass}
                    onChange={(event) => setRecipientId(event.target.value)}
                    required
                    value={recipientId}
                  >
                    <option value="">Select recipient</option>
                    {recipientKind === "user"
                      ? users.map((user) => (
                          <option key={user.user_id} value={user.user_id}>
                            {name(user.first_name, user.last_name, user.email)}
                            {user.team_name ? ` · ${user.team_name}` : ""}
                          </option>
                        ))
                      : teams.map((team) => (
                          <option key={team.team_id} value={team.team_id}>
                            {team.team_name}
                          </option>
                        ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-[#7f8883]" />
                </div>
              </label>
            </div>
          </section>

          <section className="mt-8">
            <h3 className="text-[10px] font-semibold tracking-[0.12em] text-[#68706c] uppercase">
              Transfer settings
            </h3>
            <div className="mt-4 grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
              <label>
                <span className="mb-2 block text-xs text-[#9da5a1]">
                  Checklist
                </span>
                <div className="relative">
                  <select
                    className={selectClass}
                    onChange={(event) => setTemplateId(event.target.value)}
                    value={templateId}
                  >
                    <option value="">Use project default</option>
                    {options.templates.map((template) => (
                      <option
                        key={template.template_id}
                        value={template.template_id}
                      >
                        {template.template_name} · {template.item_count} items
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-[#7f8883]" />
                </div>
              </label>
              <label>
                <span className="mb-2 block text-xs text-[#9da5a1]">
                  Expires
                </span>
                <input
                  className={fieldClass}
                  min={toLocalDateTime(new Date(RENDER_TIMESTAMP))}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  type="datetime-local"
                  value={expiresAt}
                />
              </label>
            </div>
          </section>

          <section className="mt-8 space-y-4">
            <h3 className="text-[10px] font-semibold tracking-[0.12em] text-[#68706c] uppercase">
              Handoff context
            </h3>
            <label className="block">
              <span className="mb-2 block text-xs text-[#9da5a1]">Reason</span>
              <input
                className={fieldClass}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why is ownership changing?"
                value={reason}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs text-[#9da5a1]">Notes</span>
              <textarea
                className={`${fieldClass} min-h-24 resize-y py-3`}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Context the recipient should know"
                value={notes}
              />
            </label>
          </section>

          <div className="mt-8 flex justify-end gap-3 pb-2">
            <button
              className="h-10 px-4 text-sm text-[#9da5a1] hover:text-white"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="flex h-10 items-center gap-2 rounded-lg bg-[#2b8d70] px-5 text-sm font-semibold text-white hover:bg-[#34a482] disabled:opacity-50"
              disabled={busy || !recipientId}
              type="submit"
            >
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Create draft
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

const ACTION_COPY: Record<
  TransferAction,
  { title: string; description: string; confirm: string; destructive?: boolean }
> = {
  validate: {
    title: "Validate transfer",
    description:
      "Check recipient eligibility, ownership state and every required checklist item.",
    confirm: "Run validation",
  },
  submit: {
    title: "Submit transfer",
    description:
      "Send this transfer to the recipient for a final decision. Required checklist items must be complete.",
    confirm: "Submit transfer",
  },
  accept: {
    title: "Accept ownership",
    description:
      "Ownership will move immediately to the selected person or team.",
    confirm: "Accept transfer",
  },
  reject: {
    title: "Reject transfer",
    description: "The requester will see your rejection reason.",
    confirm: "Reject transfer",
    destructive: true,
  },
  cancel: {
    title: "Cancel transfer",
    description: "This request will close without changing ownership.",
    confirm: "Cancel transfer",
    destructive: true,
  },
  expire: {
    title: "Expire transfer",
    description: "Close this overdue request without changing ownership.",
    confirm: "Expire transfer",
    destructive: true,
  },
  "force-assign": {
    title: "Force assignment",
    description:
      "Administrative override: ownership will change without recipient acceptance.",
    confirm: "Force assign",
    destructive: true,
  },
};

function ActionDialog({
  action,
  busy,
  onClose,
  onConfirm,
}: {
  action: TransferAction;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const copy = ACTION_COPY[action];
  return (
    <Modal description={copy.description} onClose={onClose} title={copy.title}>
      <div className="p-6">
        {(action === "reject" ||
          action === "cancel" ||
          action === "force-assign") && (
          <label>
            <span className="mb-2 block text-xs text-[#9da5a1]">
              Reason {action === "reject" ? "*" : "(optional)"}
            </span>
            <textarea
              autoFocus
              className={`${fieldClass} min-h-24 resize-y py-3`}
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
          </label>
        )}
        <div className="mt-6 flex justify-end gap-3 border-t border-white/[0.08] pt-5">
          <button
            className="h-10 px-4 text-sm text-[#9da5a1] hover:text-white"
            onClick={onClose}
            type="button"
          >
            Go back
          </button>
          <button
            className={`flex h-10 items-center gap-2 rounded-lg px-5 text-sm font-semibold text-white disabled:opacity-45 ${copy.destructive ? "bg-[#8f403a] hover:bg-[#a94b44]" : "bg-[#2b8d70] hover:bg-[#34a482]"}`}
            disabled={busy || (action === "reject" && !reason.trim())}
            onClick={() => onConfirm(reason.trim())}
            type="button"
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {copy.confirm}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function TransferWorkspace() {
  const router = useRouter();
  const lastLoadedTransfersQueryRef = useRef<string | null>(null);
  const [context, setContext] = useState<WorkspaceContext | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [workspaceTab, setWorkspaceTab] = useState<"leads" | "transfers">(
    "leads",
  );
  const [leadOptions, setLeadOptions] = useState<TransferOptions | null>(null);
  const [leadLoading, setLeadLoading] = useState(true);
  const [leadError, setLeadError] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TransferDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("overview");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [history, setHistory] = useState<TransferHistory[]>([]);
  const [eligibleUsers, setEligibleUsers] = useState<EligibleUser[]>([]);
  const [eligibleTeams, setEligibleTeams] = useState<EligibleTeam[]>([]);
  const [recipientKind, setRecipientKind] = useState<"user" | "team">("user");
  const [recipientId, setRecipientId] = useState("");
  const [action, setAction] = useState<TransferAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [checklistBusy, setChecklistBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api<WorkspaceContext>("/api/auth/project-context"),
      api<{ user: CurrentUser }>("/api/auth/me"),
    ])
      .then(([workspace, me]) => {
        if (!active) return;
        setContext(workspace);
        setCurrentUser(me.user);
        const projects = workspace.projects ?? [];
        const requested = new URLSearchParams(window.location.search).get(
          "project_id",
        );
        const stored = window.localStorage.getItem("sthyra-project-id");
        const available = new Set(
          projects.map((project) => String(project.project_id)),
        );
        setProjectFilter(
          requested && available.has(requested)
            ? requested
            : stored && available.has(stored)
              ? stored
              : String(projects[0]?.project_id ?? ""),
        );
        const requestedTransfer = new URLSearchParams(
          window.location.search,
        ).get("transfer_id");
        if (requestedTransfer) {
          setWorkspaceTab("transfers");
          setSelectedId(requestedTransfer);
        }
      })
      .catch((cause) => {
        if (!active) return;
        if (
          cause instanceof Error &&
          cause.message === "Authentication required"
        ) {
          router.replace("/login");
          return;
        }
        setError(
          cause instanceof Error ? cause.message : "Unable to load workspace",
        );
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [router]);

  const loadTransfers = useCallback(
    async (quiet = false) => {
      if (!projectFilter) return;
      const params = new URLSearchParams({ limit: "100" });
      if (projectFilter !== "all") params.set("project_id", projectFilter);
      if (typeFilter !== "all") params.set("subject_type", typeFilter);
      if (statusFilter !== "all" && statusFilter !== "active")
        params.set("status", statusFilter);
      const queryKey = params.toString();
      const background =
        quiet || lastLoadedTransfersQueryRef.current === queryKey;
      if (background) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const payload = await api<{ transfers?: Transfer[] }>(
          `/api/transfers?${params.toString()}`,
        );
        const rows = payload.transfers ?? [];
        lastLoadedTransfersQueryRef.current = queryKey;
        setTransfers(
          statusFilter === "active"
            ? rows.filter((item) => ACTIVE_STATUSES.includes(item.status))
            : rows,
        );
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Unable to load transfers",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectFilter, statusFilter, typeFilter],
  );

  useEffect(() => {
    // Data fetching is intentionally triggered when the server-side filters change.
    const task = window.setTimeout(() => void loadTransfers(), 0);
    return () => window.clearTimeout(task);
  }, [loadTransfers]);

  const loadLeads = useCallback(
    async (quiet = false) => {
      if (!projectFilter || projectFilter === "all") {
        setLeadOptions(null);
        setLeadLoading(false);
        return;
      }
      if (quiet) setRefreshing(true);
      else setLeadLoading(true);
      setLeadError(null);
      try {
        const payload = await api<TransferOptions>(
          `/api/transfers/options?project_id=${projectFilter}&subject_type=lead`,
        );
        setLeadOptions(payload);
      } catch (cause) {
        setLeadError(
          cause instanceof Error ? cause.message : "Unable to load leads",
        );
      } finally {
        setLeadLoading(false);
        setRefreshing(false);
      }
    },
    [projectFilter],
  );

  useEffect(() => {
    // The lead workspace follows the selected project.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLeads();
  }, [loadLeads]);

  const loadDetail = useCallback(async (transferId: string) => {
    setDetailLoading(true);
    try {
      const [detailData, checklistData, historyData, recipientData] =
        await Promise.all([
          api<{ transfer: TransferDetail }>(`/api/transfers/${transferId}`),
          api<{ items?: ChecklistItem[] }>(
            `/api/transfers/${transferId}/checklist`,
          ),
          api<{ history?: TransferHistory[] }>(
            `/api/transfers/${transferId}/history?limit=100`,
          ),
          api<{ users?: EligibleUser[]; teams?: EligibleTeam[] }>(
            `/api/transfers/${transferId}/eligible-recipients`,
          ),
        ]);
      setDetail(detailData.transfer);
      setChecklist(checklistData.items ?? []);
      setHistory(historyData.history ?? []);
      setEligibleUsers(recipientData.users ?? []);
      setEligibleTeams(recipientData.teams ?? []);
      setRecipientKind(detailData.transfer.to_team_id ? "team" : "user");
      setRecipientId(
        detailData.transfer.to_owner_user_id ??
          detailData.transfer.to_team_id ??
          "",
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Unable to load transfer details",
      );
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    // The drawer owns a separate aggregate request keyed by the selected transfer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedId) void loadDetail(selectedId);
    else {
      setDetail(null);
      setChecklist([]);
      setHistory([]);
    }
  }, [loadDetail, selectedId]);

  const visibleTransfers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return transfers;
    return transfers.filter((transfer) =>
      [
        transfer.subject_name,
        transfer.project_name,
        recipientLabel(transfer),
        transfer.reason,
        transfer.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [query, transfers]);

  const visibleLeads = useMemo(() => {
    const rows = leadOptions?.subjects ?? [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((lead) =>
      [
        lead.subject_name,
        lead.email,
        lead.phone_number,
        lead.stage_name,
        lead.status,
        lead.owner_first_name,
        lead.owner_last_name,
        lead.owner_team_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [leadOptions, query]);

  const selectedLead = leadOptions?.subjects.find(
    (lead) => lead.subject_id === selectedLeadId,
  );

  const metrics = useMemo(
    () => ({
      active: transfers.filter((item) => ACTIVE_STATUSES.includes(item.status))
        .length,
      awaiting: transfers.filter((item) => item.status === "submitted").length,
      accepted: transfers.filter((item) =>
        ["accepted", "force_assigned"].includes(item.status),
      ).length,
      overdue: transfers.filter(
        (item) =>
          ACTIVE_STATUSES.includes(item.status) &&
          item.expires_at &&
          new Date(item.expires_at).getTime() < RENDER_TIMESTAMP,
      ).length,
    }),
    [transfers],
  );

  const admin = Boolean(context?.can_view_all_projects);
  const requester = Boolean(
    detail && currentUser && detail.requested_by === currentUser.user_id,
  );
  const recipient = Boolean(
    detail &&
    currentUser &&
    (detail.to_owner_user_id === currentUser.user_id ||
      (detail.to_team_id && detail.to_team_id === currentUser.team_id)),
  );

  async function refreshDetail() {
    if (!selectedId) return;
    await Promise.all([loadDetail(selectedId), loadTransfers(true)]);
  }

  async function runAction(reason: string) {
    if (!detail || !action) return;
    setActionBusy(true);
    try {
      const endpoint = action;
      await api(`/api/transfers/${detail.transfer_id}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      toast.success(
        action === "validate"
          ? "Transfer validated"
          : `Transfer ${label(action).toLowerCase()}`,
      );
      window.dispatchEvent(new Event("notifications:changed"));
      setAction(null);
      await refreshDetail();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Transfer action failed",
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function saveChecklist() {
    if (!detail) return;
    setChecklistBusy(true);
    try {
      await api(`/api/transfers/${detail.transfer_id}/checklist`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: checklist.map((item) => ({
            item_id: item.item_id,
            is_completed: item.is_completed,
            notes: item.notes?.trim() || null,
          })),
        }),
      });
      toast.success("Checklist saved");
      await refreshDetail();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Unable to save checklist",
      );
    } finally {
      setChecklistBusy(false);
    }
  }

  async function updateRecipient() {
    if (!detail || !recipientId) return;
    setActionBusy(true);
    try {
      await api(`/api/transfers/${detail.transfer_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          recipientKind === "user"
            ? { to_owner_user_id: recipientId }
            : { to_team_id: recipientId },
        ),
      });
      toast.success("Recipient updated; validation reset");
      await refreshDetail();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Unable to update recipient",
      );
    } finally {
      setActionBusy(false);
    }
  }

  const canEditChecklist = Boolean(
    detail &&
    ACTIVE_STATUSES.includes(detail.status) &&
    (admin || requester || recipient),
  );

  return (
    <main className="min-h-dvh bg-black text-[#f5f5f5]">
      <DashboardSidebar />
      <section className="ml-[96px] min-h-dvh py-8 pr-8 pb-12 max-[780px]:py-5 max-[780px]:pr-4 max-[560px]:ml-[84px] max-[560px]:px-3">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs text-[#5b5b5b]">
              {context?.company?.company_name ?? "Workspace"} / Ownership
            </p>
            <h1 className="mt-3 font-[var(--font-bricolage)] text-[clamp(32px,3.2vw,44px)] font-medium tracking-[-0.035em]">
              Transfers
            </h1>
            <p className="mt-2 text-sm text-[#b4b4b4]">
              Controlled handoffs with recipient validation and an auditable
              checklist.
            </p>
          </div>
          <button
            aria-label={`Refresh ${workspaceTab}`}
            className="grid size-11 place-items-center rounded-[10px] border border-[#363636] bg-[#191919] text-[#999] transition hover:bg-[#262626] hover:text-white"
            disabled={refreshing}
            onClick={() =>
              void (workspaceTab === "leads"
                ? loadLeads(true)
                : loadTransfers(true))
            }
            type="button"
          >
            <RefreshCw
              className={`size-4 ${refreshing ? "animate-spin" : ""}`}
            />
          </button>
        </header>

        <nav className="mt-7 flex items-center gap-1 overflow-x-auto rounded-xl border border-[#2c2c2c] bg-[#191919] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[
            ["leads", "Leads"],
            ["transfers", "Transfers"],
          ].map(([tab, tabLabel]) => (
            <button
              className={`h-10 min-w-28 shrink-0 rounded-lg px-4 text-sm font-medium transition ${workspaceTab === tab ? "bg-[#3b3b3b] text-white" : "text-[#999] hover:bg-[#242424] hover:text-white"}`}
              key={tab}
              onClick={() => {
                setWorkspaceTab(tab as "leads" | "transfers");
                setQuery("");
                if (tab === "leads" && projectFilter === "all") {
                  setProjectFilter(
                    String(context?.projects?.[0]?.project_id ?? ""),
                  );
                }
              }}
              type="button"
            >
              {tabLabel}
            </button>
          ))}
        </nav>

        {workspaceTab === "transfers" ? (
          <>
            <section className="mt-4 overflow-hidden rounded-2xl border border-[#2c2c2c] bg-[#080808]">
              <header className="border-b border-[#2c2c2c] bg-[#191919] px-4 py-3 text-sm font-medium text-[#dedede]">
                Overview
              </header>
              <div className="grid grid-cols-4 max-[760px]:grid-cols-2 max-[520px]:grid-cols-1">
                {[
                  ["Active", metrics.active, "Transfers in progress"],
                  [
                    "Awaiting decision",
                    metrics.awaiting,
                    "Ready for recipient action",
                  ],
                  ["Completed", metrics.accepted, "Accepted handoffs"],
                  ["Overdue", metrics.overdue, "Past their expiry time"],
                ].map(([metricLabel, value, description], index) => (
                  <div
                    className={`min-w-0 px-4 py-4 ${index ? "border-l border-[#2c2c2c] max-[520px]:border-l-0" : ""} ${index === 2 ? "max-[760px]:border-l-0" : ""} ${index > 1 ? "max-[760px]:border-t max-[760px]:border-[#2c2c2c]" : ""} ${index ? "max-[520px]:border-t max-[520px]:border-[#2c2c2c]" : ""}`}
                    key={metricLabel}
                  >
                    <span className="text-[11px] font-medium text-[#929292]">
                      {metricLabel}
                    </span>
                    <strong className="mt-2 block text-2xl font-semibold tracking-[-0.03em] text-white">
                      {value}
                    </strong>
                    <span className="mt-1 block text-[11px] text-[#707070]">
                      {description}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="my-4 flex flex-wrap items-center gap-2">
              <label className="relative min-w-[260px] flex-1">
                <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#777]" />
                <input
                  className="h-11 w-full rounded-[10px] border border-[#2c2c2c] bg-[#111] pr-3 pl-10 text-sm text-white outline-none transition placeholder:text-[#666] focus:border-[#50c4a2]/70"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search record, project, recipient or reason"
                  value={query}
                />
              </label>
              <label className="relative max-[650px]:w-full">
                <select
                  className="h-11 min-w-44 appearance-none rounded-[10px] border border-[#2c2c2c] bg-[#191919] pr-9 pl-3 text-xs text-[#d7dcda] outline-none transition focus:border-[#50c4a2]/70 max-[650px]:w-full"
                  onChange={(event) => {
                    setProjectFilter(event.target.value);
                    if (event.target.value !== "all")
                      window.localStorage.setItem(
                        "sthyra-project-id",
                        event.target.value,
                      );
                  }}
                  value={projectFilter}
                >
                  {context?.can_view_all_projects && (
                    <option value="all">All projects</option>
                  )}
                  {context?.projects?.map((project) => (
                    <option key={project.project_id} value={project.project_id}>
                      {project.project_name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-[#747c78]" />
              </label>
              <label className="relative max-[650px]:w-full">
                <select
                  className="h-11 min-w-32 appearance-none rounded-[10px] border border-[#2c2c2c] bg-[#191919] pr-9 pl-3 text-xs text-[#d7dcda] outline-none transition focus:border-[#50c4a2]/70 max-[650px]:w-full"
                  onChange={(event) => setTypeFilter(event.target.value)}
                  value={typeFilter}
                >
                  <option value="all">All records</option>
                  <option value="lead">Leads</option>
                  <option value="opportunity">Opportunities</option>
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-[#747c78]" />
              </label>
              <label className="relative max-[650px]:w-full">
                <select
                  className="h-11 min-w-36 appearance-none rounded-[10px] border border-[#2c2c2c] bg-[#191919] pr-9 pl-3 text-xs text-[#d7dcda] outline-none transition focus:border-[#50c4a2]/70 max-[650px]:w-full"
                  onChange={(event) => setStatusFilter(event.target.value)}
                  value={statusFilter}
                >
                  <option value="active">Active</option>
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="validated">Validated</option>
                  <option value="submitted">Submitted</option>
                  <option value="accepted">Accepted</option>
                  <option value="rejected">Rejected</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="expired">Expired</option>
                  <option value="force_assigned">Force assigned</option>
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-[#747c78]" />
              </label>
            </section>

            <section className="overflow-hidden rounded-2xl border border-[#2c2c2c] bg-[#080808]">
              <header className="flex items-center justify-between gap-4 border-b border-[#2c2c2c] bg-[#191919] px-4 py-3">
                <strong className="text-sm font-medium text-[#dedede]">
                  Ownership transfers
                </strong>
                <span className="text-[11px] text-[#777]">
                  {visibleTransfers.length} records
                </span>
              </header>
              {loading ? (
                <div className="flex min-h-80 items-center justify-center gap-3 text-sm text-[#747c78]">
                  <LoaderCircle className="size-5 animate-spin" /> Loading
                  transfers…
                </div>
              ) : error ? (
                <div className="flex min-h-80 flex-col items-center justify-center text-center">
                  <CircleAlert className="size-6 text-[#8d9691]" />
                  <p className="mt-4 text-sm font-semibold">
                    Transfers could not be loaded
                  </p>
                  <p className="mt-1 text-xs text-[#747c78]">{error}</p>
                  <button
                    className="mt-4 text-xs font-semibold text-[#68d2b1]"
                    onClick={() => void loadTransfers()}
                    type="button"
                  >
                    Try again
                  </button>
                </div>
              ) : !visibleTransfers.length ? (
                <div className="flex min-h-80 flex-col items-center justify-center text-center">
                  <Send className="size-6 text-[#737b77]" />
                  <p className="mt-4 text-sm font-semibold text-[#dfe3e0]">
                    No transfers match these filters
                  </p>
                  <p className="mt-1 text-xs text-[#707874]">
                    Create a controlled ownership handoff when a lead or
                    opportunity changes hands.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] border-collapse text-left">
                    <thead className="bg-[#080808] text-[10px] tracking-[0.08em] text-[#777] uppercase">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Record</th>
                        <th className="px-4 py-3 font-semibold">Project</th>
                        <th className="px-4 py-3 font-semibold">Recipient</th>
                        <th className="px-4 py-3 font-semibold">
                          Requested by
                        </th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Expires</th>
                        <th className="w-10 px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2c2c2c]">
                      {visibleTransfers.map((transfer) => (
                        <tr
                          className="h-[72px] cursor-pointer transition hover:bg-[#101010]"
                          key={transfer.transfer_id}
                          onClick={() => {
                            setDrawerTab("overview");
                            setSelectedId(transfer.transfer_id);
                          }}
                        >
                          <td className="px-4 py-4">
                            <strong className="block text-sm text-[#e5e9e6]">
                              {transfer.subject_name || "Unnamed record"}
                            </strong>
                            <span className="mt-1 block text-[10px] text-[#6f7773] capitalize">
                              {transfer.subject_type}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-xs text-[#a4aca8]">
                            {transfer.project_name}
                          </td>
                          <td className="px-4 py-4 text-xs text-[#d1d6d3]">
                            {recipientLabel(transfer)}
                          </td>
                          <td className="px-4 py-4 text-xs text-[#929a96]">
                            {name(
                              transfer.requester_first_name,
                              transfer.requester_last_name,
                            )}
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium ${statusTone(transfer.status)}`}
                            >
                              {label(transfer.status)}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-xs text-[#929a96]">
                            {formatDate(transfer.expires_at, true)}
                          </td>
                          <td className="px-4 py-4 text-[#59615d]">→</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : (
          <>
            <section className="my-4 flex flex-wrap items-center gap-2">
              <label className="relative min-w-[260px] flex-1">
                <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#777]" />
                <input
                  className="h-11 w-full rounded-[10px] border border-[#2c2c2c] bg-[#111] pr-3 pl-10 text-sm text-white outline-none transition placeholder:text-[#666] focus:border-[#50c4a2]/70"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search leads by name, email, stage or owner"
                  value={query}
                />
              </label>
              <label className="relative max-[650px]:w-full">
                <select
                  className="h-11 min-w-52 appearance-none rounded-[10px] border border-[#2c2c2c] bg-[#191919] pr-9 pl-3 text-xs text-[#d7dcda] outline-none transition focus:border-[#50c4a2]/70 max-[650px]:w-full"
                  onChange={(event) => {
                    setProjectFilter(event.target.value);
                    setSelectedLeadId(null);
                    window.localStorage.setItem(
                      "sthyra-project-id",
                      event.target.value,
                    );
                  }}
                  value={projectFilter}
                >
                  {context?.projects?.map((project) => (
                    <option key={project.project_id} value={project.project_id}>
                      {project.project_name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-[#747c78]" />
              </label>
            </section>

            <section className="overflow-hidden rounded-2xl border border-[#2c2c2c] bg-[#080808]">
              <header className="flex items-center justify-between gap-4 border-b border-[#2c2c2c] bg-[#191919] px-4 py-3 text-xs text-[#888]">
                <span>
                  Select a lead to prepare an ownership transfer in the side
                  panel.
                </span>
                <span>{visibleLeads.length} leads</span>
              </header>

              {leadLoading ? (
                <div className="flex min-h-80 items-center justify-center gap-3 text-sm text-[#747c78]">
                  <LoaderCircle className="size-5 animate-spin" /> Loading
                  leads…
                </div>
              ) : leadError ? (
                <div className="flex min-h-80 flex-col items-center justify-center text-center">
                  <CircleAlert className="size-6 text-[#8d9691]" />
                  <p className="mt-4 text-sm font-semibold">
                    Leads could not be loaded
                  </p>
                  <p className="mt-1 text-xs text-[#747c78]">{leadError}</p>
                  <button
                    className="mt-4 text-xs font-semibold text-[#68d2b1]"
                    onClick={() => void loadLeads()}
                    type="button"
                  >
                    Try again
                  </button>
                </div>
              ) : !visibleLeads.length ? (
                <div className="flex min-h-80 flex-col items-center justify-center text-center">
                  <Send className="size-6 text-[#737b77]" />
                  <p className="mt-4 text-sm font-semibold text-[#dfe3e0]">
                    No leads found
                  </p>
                  <p className="mt-1 text-xs text-[#707874]">
                    No leads match the current project and search.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse text-left">
                    <thead className="bg-[#080808] text-[10px] tracking-[0.08em] text-[#777] uppercase">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Lead</th>
                        <th className="px-4 py-3 font-semibold">Contact</th>
                        <th className="px-4 py-3 font-semibold">Stage</th>
                        <th className="px-4 py-3 font-semibold">Owner</th>
                        <th className="w-32 px-4 py-3 font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2c2c2c]">
                      {visibleLeads.map((lead) => (
                        <tr
                          className="h-[72px] cursor-pointer transition hover:bg-[#101010]"
                          key={lead.subject_id}
                          onClick={() => {
                            if (lead.active_transfer_id) {
                              setWorkspaceTab("transfers");
                              setDrawerTab("overview");
                              setSelectedId(lead.active_transfer_id);
                              return;
                            }
                            setSelectedLeadId(lead.subject_id);
                          }}
                        >
                          <td className="px-4 py-4">
                            <strong className="block text-sm text-[#e5e9e6]">
                              {lead.subject_name || "Unnamed lead"}
                            </strong>
                            <span className="mt-1 block font-mono text-[10px] text-[#626a66]">
                              {lead.subject_id.slice(0, 8)}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-xs text-[#9ca4a0]">
                            <span className="block">{lead.email || "—"}</span>
                            {lead.phone_number && (
                              <span className="mt-1 block text-[10px] text-[#626a66]">
                                {lead.phone_number}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-4">
                            <span className="inline-flex rounded-full border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-[10px] text-[#b2b9b5]">
                              {lead.stage_name ?? label(lead.status)}
                            </span>
                            {lead.temperature && (
                              <span className="ml-2 text-[10px] text-[#777f7b]">
                                {label(lead.temperature)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-4 text-xs text-[#b7beba]">
                            {lead.owner_first_name || lead.owner_last_name
                              ? name(
                                  lead.owner_first_name,
                                  lead.owner_last_name,
                                )
                              : (lead.owner_team_name ?? "Unassigned")}
                          </td>
                          <td className="px-4 py-4">
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#67ceb0]">
                              {lead.active_transfer_id
                                ? `View ${label(lead.active_transfer_status)}`
                                : "Transfer"}{" "}
                              <ArrowRight className="size-3.5" />
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </section>

      {selectedLead && leadOptions && (
        <CreateTransferDrawer
          onClose={() => setSelectedLeadId(null)}
          onCreated={async (transfer) => {
            setSelectedLeadId(null);
            setWorkspaceTab("transfers");
            await Promise.all([loadLeads(), loadTransfers(true)]);
            setSelectedId(transfer.transfer_id);
          }}
          options={leadOptions}
          subject={selectedLead}
        />
      )}

      {selectedId && (
        <>
          <button
            aria-label="Close transfer details"
            className="fixed inset-0 z-[80] bg-black/75"
            onClick={() => setSelectedId(null)}
            type="button"
          />
          <aside className="fixed inset-y-0 right-0 z-[90] flex w-full max-w-[760px] flex-col overflow-hidden border-l border-[#2c2c2c] bg-[#111] shadow-[-30px_0_90px_rgba(0,0,0,.6)] max-[560px]:max-w-full">
            {detailLoading || !detail ? (
              <div className="flex flex-1 items-center justify-center gap-3 text-sm text-[#7d8581]">
                <LoaderCircle className="size-5 animate-spin" /> Loading
                transfer…
              </div>
            ) : (
              <>
                <header className="shrink-0 border-b border-[#2c2c2c] bg-[#111] px-6 pt-5">
                  <div className="flex items-start justify-between gap-4 pb-5">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold tracking-[0.16em] text-[#69716d] uppercase">
                        {label(detail.subject_type)} transfer
                      </p>
                      <h2 className="mt-2 truncate font-[var(--font-bricolage)] text-2xl font-semibold tracking-[-0.025em]">
                        {detail.subject_name}
                      </h2>
                      <div className="mt-2 flex items-center gap-2 text-xs text-[#89918d]">
                        <span>{detail.project_name}</span>
                        <span>·</span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${statusTone(detail.status)}`}
                        >
                          {label(detail.status)}
                        </span>
                      </div>
                    </div>
                    <button
                      aria-label="Close"
                      className="grid size-9 place-items-center rounded-lg border border-[#2c2c2c] bg-[#191919] text-[#999] hover:bg-[#262626] hover:text-white"
                      onClick={() => setSelectedId(null)}
                      type="button"
                    >
                      <X className="size-5" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-[#2c2c2c] py-3">
                    {detail.status === "draft" ||
                    detail.status === "validated" ? (
                      <>
                        {(requester || admin) && (
                          <button
                            className="flex h-9 items-center gap-1.5 rounded-lg bg-[#2b8d70] px-3 text-xs font-semibold text-white hover:bg-[#34a482]"
                            onClick={() => setAction("submit")}
                            type="button"
                          >
                            <Send className="size-3.5" /> Submit
                          </button>
                        )}
                      </>
                    ) : detail.status === "submitted" ? (
                      <>
                        {requester && !recipient && (
                          <span className="mr-auto text-xs text-[#8f9792]">
                            Awaiting recipient decision
                          </span>
                        )}
                        {recipient && (
                          <button
                            className="flex h-9 items-center gap-1.5 rounded-lg bg-[#2b8d70] px-3 text-xs font-semibold text-white hover:bg-[#34a482]"
                            onClick={() => setAction("accept")}
                            type="button"
                          >
                            <Check className="size-3.5" /> Accept
                          </button>
                        )}
                        {recipient && (
                          <button
                            className="flex h-9 items-center gap-1.5 rounded-lg border border-[#bb665f]/30 px-3 text-xs text-[#e99a93] hover:bg-[#3a201e]"
                            onClick={() => setAction("reject")}
                            type="button"
                          >
                            <XCircle className="size-3.5" /> Reject
                          </button>
                        )}
                      </>
                    ) : null}
                    {ACTIVE_STATUSES.includes(detail.status) &&
                      (requester || admin) && (
                        <button
                          className="h-9 px-3 text-xs text-[#8f9792] hover:text-[#e99a93]"
                          onClick={() => setAction("cancel")}
                          type="button"
                        >
                          Cancel
                        </button>
                      )}
                    {ACTIVE_STATUSES.includes(detail.status) &&
                      admin &&
                      !requester && (
                        <button
                          className="ml-auto h-9 px-3 text-xs font-medium text-[#e2b578] hover:text-[#f3cc98]"
                          onClick={() => setAction("force-assign")}
                          type="button"
                        >
                          Force assign
                        </button>
                      )}
                    {ACTIVE_STATUSES.includes(detail.status) &&
                      admin &&
                      detail.expires_at &&
                      new Date(detail.expires_at).getTime() <=
                        RENDER_TIMESTAMP && (
                        <button
                          className="h-9 px-3 text-xs text-[#8f9792] hover:text-white"
                          onClick={() => setAction("expire")}
                          type="button"
                        >
                          Mark expired
                        </button>
                      )}
                  </div>

                  <nav className="flex gap-6 overflow-x-auto [scrollbar-width:none]">
                    {[
                      ["overview", "Overview"],
                      [
                        "checklist",
                        `Checklist ${checklist.filter((item) => item.is_completed).length}/${checklist.length}`,
                      ],
                      ["history", "History"],
                    ].map(([tab, tabLabel]) => (
                      <button
                        className={`h-11 shrink-0 border-b-2 text-xs font-medium ${drawerTab === tab ? "border-[#55cdaa] text-white" : "border-transparent text-[#7e8682] hover:text-[#cbd0cd]"}`}
                        key={tab}
                        onClick={() => setDrawerTab(tab as DrawerTab)}
                        type="button"
                      >
                        {tabLabel}
                      </button>
                    ))}
                  </nav>
                </header>

                <div className="flex-1 overflow-y-auto bg-[#0b0b0b] px-6 py-6 [scrollbar-color:#303633_transparent] [scrollbar-width:thin]">
                  {drawerTab === "overview" && (
                    <div className="space-y-8">
                      <section>
                        <h3 className="text-[10px] font-semibold tracking-[0.12em] text-[#68706c] uppercase">
                          Ownership handoff
                        </h3>
                        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-5 border-y border-white/[0.08] py-5 max-[520px]:grid-cols-1">
                          <div>
                            <span className="text-[10px] tracking-[0.08em] text-[#68706c] uppercase">
                              Current owner
                            </span>
                            <p className="mt-2 text-sm text-[#dce1de]">
                              {detail.previous_owner
                                ? name(
                                    detail.previous_owner.first_name,
                                    detail.previous_owner.last_name,
                                    detail.previous_owner.email ??
                                      "Assigned user",
                                  )
                                : (detail.previous_team?.team_name ??
                                  "Unassigned")}
                            </p>
                          </div>
                          <ArrowRight className="size-5 text-[#53605a] max-[520px]:rotate-90" />
                          <div>
                            <span className="text-[10px] tracking-[0.08em] text-[#68706c] uppercase">
                              Recipient
                            </span>
                            <p className="mt-2 text-sm font-medium text-[#e5e9e6]">
                              {detail.recipient
                                ? name(
                                    detail.recipient.first_name,
                                    detail.recipient.last_name,
                                    detail.recipient.email ?? "Recipient",
                                  )
                                : (detail.recipient_team?.team_name ??
                                  recipientLabel(detail))}
                            </p>
                          </div>
                        </div>
                      </section>

                      {(detail.status === "draft" ||
                        detail.status === "validated") &&
                        (requester || admin) && (
                          <section>
                            <h3 className="text-[10px] font-semibold tracking-[0.12em] text-[#68706c] uppercase">
                              Change recipient
                            </h3>
                            <div className="mt-3 flex gap-3 max-[520px]:flex-col">
                              <select
                                className={`${fieldClass} max-w-36`}
                                onChange={(event) => {
                                  setRecipientKind(
                                    event.target.value as "user" | "team",
                                  );
                                  setRecipientId("");
                                }}
                                value={recipientKind}
                              >
                                <option value="user">Person</option>
                                <option value="team">Team</option>
                              </select>
                              <select
                                className={fieldClass}
                                onChange={(event) =>
                                  setRecipientId(event.target.value)
                                }
                                value={recipientId}
                              >
                                <option value="">Select recipient</option>
                                {recipientKind === "user"
                                  ? eligibleUsers.map((user) => (
                                      <option
                                        key={user.user_id}
                                        value={user.user_id}
                                      >
                                        {name(
                                          user.first_name,
                                          user.last_name,
                                          user.email,
                                        )}
                                      </option>
                                    ))
                                  : eligibleTeams.map((team) => (
                                      <option
                                        key={team.team_id}
                                        value={team.team_id}
                                      >
                                        {team.team_name}
                                      </option>
                                    ))}
                              </select>
                              <button
                                className="h-11 shrink-0 rounded-lg border border-white/[0.11] px-4 text-xs font-semibold text-[#dce1de] hover:bg-white/[0.05] disabled:opacity-45"
                                disabled={!recipientId || actionBusy}
                                onClick={() => void updateRecipient()}
                                type="button"
                              >
                                Update
                              </button>
                            </div>
                          </section>
                        )}

                      <section>
                        <h3 className="text-[10px] font-semibold tracking-[0.12em] text-[#68706c] uppercase">
                          Transfer details
                        </h3>
                        <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-6 border-y border-white/[0.08] py-5 max-[520px]:grid-cols-1">
                          {[
                            ["Requested", formatDate(detail.created_at, true)],
                            ["Expires", formatDate(detail.expires_at, true)],
                            [
                              "Requested by",
                              detail.requester
                                ? name(
                                    detail.requester.first_name,
                                    detail.requester.last_name,
                                    detail.requester.email ?? "Requester",
                                  )
                                : detail.requested_by,
                            ],
                            ["Record type", label(detail.subject_type)],
                          ].map(([term, value]) => (
                            <div key={term}>
                              <dt className="text-[10px] tracking-[0.08em] text-[#68706c] uppercase">
                                {term}
                              </dt>
                              <dd className="mt-1.5 text-sm text-[#d7dcda]">
                                {value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </section>

                      {(detail.reason || detail.notes) && (
                        <section>
                          <h3 className="text-[10px] font-semibold tracking-[0.12em] text-[#68706c] uppercase">
                            Handoff context
                          </h3>
                          {detail.reason && (
                            <p className="mt-3 text-sm text-[#d7dcda]">
                              {detail.reason}
                            </p>
                          )}
                          {detail.notes && (
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#8f9792]">
                              {detail.notes}
                            </p>
                          )}
                        </section>
                      )}

                      {Boolean(detail.validation_errors?.length) && (
                        <section className="border-y border-[#bd695f]/20 bg-[#351f1d]/35 px-4 py-4">
                          <p className="text-xs font-semibold text-[#e99a93]">
                            Validation needs attention
                          </p>
                          <ul className="mt-2 space-y-1 text-xs text-[#bf8b86]">
                            {detail.validation_errors?.map((item) => (
                              <li key={item}>• {item}</li>
                            ))}
                          </ul>
                        </section>
                      )}

                      <Link
                        className="inline-flex items-center gap-2 text-xs font-semibold text-[#6ed3b3] no-underline hover:text-[#a3ead4]"
                        href={
                          detail.subject_type === "lead"
                            ? `/leads?lead_id=${detail.lead_id}`
                            : `/opportunities?opportunity_id=${detail.opportunity_id}`
                        }
                      >
                        Open {detail.subject_type}{" "}
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </div>
                  )}

                  {drawerTab === "checklist" && (
                    <div>
                      <div className="flex items-end justify-between gap-4 border-b border-white/[0.08] pb-4">
                        <div>
                          <h3 className="text-sm font-semibold text-[#e4e8e5]">
                            Handoff checklist
                          </h3>
                          <p className="mt-1 text-xs text-[#747c78]">
                            Required items must be complete before submission.
                          </p>
                        </div>
                        {canEditChecklist && checklist.length > 0 && (
                          <button
                            className="flex h-9 items-center gap-2 rounded-lg bg-[#2b8d70] px-3 text-xs font-semibold text-white disabled:opacity-45"
                            disabled={checklistBusy}
                            onClick={() => void saveChecklist()}
                            type="button"
                          >
                            {checklistBusy && (
                              <LoaderCircle className="size-3.5 animate-spin" />
                            )}
                            Save checklist
                          </button>
                        )}
                      </div>
                      {!checklist.length ? (
                        <div className="flex min-h-52 flex-col items-center justify-center text-center">
                          <FileCheck2 className="size-6 text-[#6c7470]" />
                          <p className="mt-3 text-sm text-[#d5dad7]">
                            No checklist was assigned
                          </p>
                        </div>
                      ) : (
                        <div className="divide-y divide-white/[0.07]">
                          {checklist.map((item, index) => (
                            <div className="py-5" key={item.item_id}>
                              <label className="flex cursor-pointer items-start gap-3">
                                <input
                                  checked={item.is_completed}
                                  className="mt-0.5 size-4 accent-[#3eae8a]"
                                  disabled={!canEditChecklist}
                                  onChange={(event) =>
                                    setChecklist((current) =>
                                      current.map((entry, itemIndex) =>
                                        itemIndex === index
                                          ? {
                                              ...entry,
                                              is_completed:
                                                event.target.checked,
                                            }
                                          : entry,
                                      ),
                                    )
                                  }
                                  type="checkbox"
                                />
                                <span className="min-w-0 flex-1">
                                  <span
                                    className={`block text-sm font-medium ${item.is_completed ? "text-[#8d9691] line-through" : "text-[#dce1de]"}`}
                                  >
                                    {item.label}
                                    {item.is_required && (
                                      <i className="ml-2 text-[9px] font-semibold not-italic text-[#d99b62] uppercase">
                                        Required
                                      </i>
                                    )}
                                  </span>
                                  {item.description && (
                                    <span className="mt-1 block text-xs leading-5 text-[#737b77]">
                                      {item.description}
                                    </span>
                                  )}
                                </span>
                              </label>
                              <input
                                className="mt-3 h-9 w-full border-0 border-b border-white/[0.1] bg-transparent px-1 text-xs text-[#aeb5b1] outline-none placeholder:text-[#525955] disabled:opacity-60"
                                disabled={!canEditChecklist}
                                onChange={(event) =>
                                  setChecklist((current) =>
                                    current.map((entry, itemIndex) =>
                                      itemIndex === index
                                        ? {
                                            ...entry,
                                            notes: event.target.value,
                                          }
                                        : entry,
                                    ),
                                  )
                                }
                                placeholder="Optional handoff note"
                                value={item.notes ?? ""}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {drawerTab === "history" && (
                    <div>
                      {!history.length ? (
                        <div className="flex min-h-52 flex-col items-center justify-center text-center">
                          <History className="size-6 text-[#6c7470]" />
                          <p className="mt-3 text-sm text-[#d5dad7]">
                            No history recorded
                          </p>
                        </div>
                      ) : (
                        history.map((event, index) => (
                          <div
                            className="relative flex gap-4 pb-7"
                            key={event.history_id}
                          >
                            {index < history.length - 1 && (
                              <i className="absolute top-7 bottom-0 left-[11px] w-px bg-white/[0.09]" />
                            )}
                            <span className="relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-white/[0.12] bg-[#111512]">
                              <i className="size-1.5 rounded-full bg-[#55cdaa]" />
                            </span>
                            <div>
                              <p className="text-sm font-medium text-[#dce1de]">
                                {label(event.action)}
                              </p>
                              <p className="mt-1 text-xs text-[#68706c]">
                                {formatDate(event.created_at, true)} ·{" "}
                                {name(
                                  event.performed_by_first_name,
                                  event.performed_by_last_name,
                                  "System",
                                )}
                              </p>
                              {typeof event.metadata?.reason === "string" &&
                                event.metadata.reason && (
                                  <p className="mt-2 text-sm text-[#969e9a]">
                                    {event.metadata.reason}
                                  </p>
                                )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>
        </>
      )}

      {action && (
        <ActionDialog
          action={action}
          busy={actionBusy}
          onClose={() => setAction(null)}
          onConfirm={(reason) => void runAction(reason)}
        />
      )}
    </main>
  );
}
