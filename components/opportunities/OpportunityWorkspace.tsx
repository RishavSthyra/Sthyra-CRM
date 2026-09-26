"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  ExternalLink,
  FileText,
  KanbanSquare,
  LayoutList,
  LoaderCircle,
  MapPin,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Target,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
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

type ProjectContext = {
  company?: { company_name?: string };
  can_view_all_projects?: boolean;
  projects?: Project[];
};

type Contact = {
  contact_id?: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone_number?: string | null;
};

type Opportunity = {
  opportunity_id: string;
  company_id: number;
  project_id: number;
  project_name: string;
  project_code: string;
  lead_id: string;
  contact_id: string;
  opportunity_name: string;
  description?: string | null;
  stage_key: string;
  status: "open" | "closed";
  amount?: string | number | null;
  probability: number;
  expected_close_date?: string | null;
  current_owner_user_id?: string | null;
  current_team_id?: string | null;
  outcome?: "won" | "lost" | null;
  closing_reason?: string | null;
  closing_notes?: string | null;
  qualified_at: string;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  owner_first_name?: string | null;
  owner_last_name?: string | null;
  team_name?: string | null;
};

type OpportunityDetail = Opportunity & {
  contact?: Contact;
  owner?: {
    user_id: string;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  } | null;
  team?: { team_id: string; team_name: string } | null;
};

type TimelineEvent = {
  event_id: string;
  event_type: string;
  data: Record<string, unknown>;
  occurred_at: string;
};

type InventoryUnit = {
  unit_id: string;
  unit_code: string;
  unit_name?: string | null;
  type_name?: string | null;
  type_code?: string | null;
  status: string;
  area_sqft?: string | number | null;
  orientation?: string | null;
  effective_price?: string | number | null;
  effective_price_currency?: string | null;
};

type ShortlistItem = {
  unit_id: string;
  unit_code: string;
  unit_name?: string | null;
  type_name?: string | null;
  status: string;
  amount?: number | null;
  currency?: string | null;
};

type Shortlist = {
  shortlist_id: string;
  title: string;
  notes?: string | null;
  status: string;
  items: ShortlistItem[];
  created_at: string;
  updated_at: string;
};

type Quotation = {
  quotation_id: string;
  quotation_number: string;
  version: number;
  status: string;
  currency: string;
  subtotal: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  valid_until?: string | null;
  line_items: ShortlistItem[];
  created_at: string;
};

type SiteVisit = {
  visit_id?: string;
  appointment_id?: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  location?: string | null;
  outcome?: string | null;
};

type DrawerTab = "overview" | "timeline" | "inventory" | "visits" | "quotes";
type ViewMode = "pipeline" | "list";

type OpportunityStage = {
  key: string;
  label: string;
  position: number;
  probability: number;
  color: string;
  isInitial: boolean;
};

type OpportunityStageApi = {
  stage_key: string;
  stage_name: string;
  position: number;
  probability: number;
  color: string;
  is_initial: boolean;
};

const FALLBACK_STAGES: OpportunityStage[] = [
  {
    key: "discovery",
    label: "Discovery",
    position: 1,
    probability: 25,
    color: "#8b9cf6",
    isInitial: true,
  },
  {
    key: "shortlisting",
    label: "Shortlisting",
    position: 2,
    probability: 40,
    color: "#a98af7",
    isInitial: false,
  },
  {
    key: "site_visit",
    label: "Site visit",
    position: 3,
    probability: 55,
    color: "#e7aa51",
    isInitial: false,
  },
  {
    key: "proposal",
    label: "Proposal",
    position: 4,
    probability: 70,
    color: "#ef83ad",
    isInitial: false,
  },
  {
    key: "negotiation",
    label: "Negotiation",
    position: 5,
    probability: 80,
    color: "#59cfaa",
    isInitial: false,
  },
  {
    key: "booking",
    label: "Booking",
    position: 6,
    probability: 90,
    color: "#75d5bc",
    isInitial: false,
  },
];

const inputClass =
  "h-11 w-full rounded-lg border border-white/[0.11] bg-[#0b0e0c] px-3.5 text-sm text-[#eef1ef] outline-none transition placeholder:text-[#59605d] focus:border-[#55c8a6]/55 focus:ring-2 focus:ring-[#55c8a6]/10 disabled:cursor-not-allowed disabled:opacity-55";

function personName(
  first?: string | null,
  last?: string | null,
  fallback = "Unknown contact",
) {
  return [first, last].filter(Boolean).join(" ") || fallback;
}

function stageLabel(key: string, stages = FALLBACK_STAGES) {
  return (
    stages.find((stage) => stage.key === key)?.label ??
    key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

function formatMoney(value?: string | number | null, currency = "INR") {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value?: string | null, includeTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

function toLocalInput(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithSession(url, {
    cache: "no-store",
    ...init,
  });
  if (!response.ok) throw new Error(await getApiError(response));
  return (await response.json()) as T;
}

function EmptyState({
  action,
  actionLabel,
  description,
  icon: Icon,
  title,
}: {
  action?: () => void;
  actionLabel?: string;
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-white/[0.045] text-[#7c8580]">
        <Icon className="size-5" />
      </span>
      <p className="mt-4 text-sm font-semibold text-[#dce1de]">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-[#717a75]">
        {description}
      </p>
      {action && actionLabel && (
        <button
          className="mt-4 text-xs font-semibold text-[#67d4b3] hover:text-[#9ae7d1]"
          onClick={action}
          type="button"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
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
      <div className="max-h-[calc(100dvh-32px)] w-full max-w-[560px] overflow-y-auto rounded-2xl border border-white/[0.13] bg-[#111512] shadow-[0_30px_100px_rgba(0,0,0,.7)]">
        <header className="flex items-start justify-between border-b border-white/[0.09] px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-[#7d8581]">{description}</p>
          </div>
          <button
            aria-label="Close"
            className="grid size-9 place-items-center rounded-lg text-[#8f9792] hover:bg-white/[0.06] hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X className="size-[18px]" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function FormActions({
  busy,
  label,
  onClose,
}: {
  busy: boolean;
  label: string;
  onClose: () => void;
}) {
  return (
    <div className="mt-7 flex justify-end gap-2 border-t border-white/[0.08] pt-5">
      <button
        className="h-10 rounded-lg border border-white/[0.11] px-4 text-sm text-[#bbc1be] hover:bg-white/[0.05]"
        onClick={onClose}
        type="button"
      >
        Cancel
      </button>
      <button
        className="flex h-10 min-w-28 items-center justify-center gap-2 rounded-lg bg-[#2b8d70] px-4 text-sm font-semibold text-white hover:bg-[#32a07f] disabled:opacity-55"
        disabled={busy}
        type="submit"
      >
        {busy && <LoaderCircle className="size-4 animate-spin" />}
        {label}
      </button>
    </div>
  );
}

function EditOpportunityDialog({
  opportunity,
  onClose,
  onSaved,
}: {
  opportunity: OpportunityDetail;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    opportunity_name: opportunity.opportunity_name,
    description: opportunity.description ?? "",
    amount: opportunity.amount === null ? "" : String(opportunity.amount ?? ""),
    probability: String(opportunity.probability),
    expected_close_date: opportunity.expected_close_date?.slice(0, 10) ?? "",
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(`/api/opportunities/${opportunity.opportunity_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunity_name: form.opportunity_name,
          description: form.description || null,
          amount: form.amount ? Number(form.amount) : null,
          probability: Number(form.probability),
          expected_close_date: form.expected_close_date || null,
        }),
      });
      toast.success("Opportunity updated");
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to update opportunity",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      description="Keep value, probability and timing current."
      onClose={onClose}
      title="Edit opportunity"
    >
      <form className="p-6" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="mb-2 block text-xs text-[#aab1ad]">Name</span>
            <input
              autoFocus
              className={inputClass}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  opportunity_name: event.target.value,
                }))
              }
              required
              value={form.opportunity_name}
            />
          </label>
          <label>
            <span className="mb-2 block text-xs text-[#aab1ad]">Value</span>
            <input
              className={inputClass}
              min="0"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  amount: event.target.value,
                }))
              }
              type="number"
              value={form.amount}
            />
          </label>
          <label>
            <span className="mb-2 block text-xs text-[#aab1ad]">
              Probability
            </span>
            <div className="relative">
              <input
                className={`${inputClass} pr-10`}
                max="100"
                min="0"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    probability: event.target.value,
                  }))
                }
                required
                type="number"
                value={form.probability}
              />
              <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-[#747c78]">
                %
              </span>
            </div>
          </label>
          <label className="sm:col-span-2">
            <span className="mb-2 block text-xs text-[#aab1ad]">
              Expected close
            </span>
            <input
              className={inputClass}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  expected_close_date: event.target.value,
                }))
              }
              type="date"
              value={form.expected_close_date}
            />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-2 block text-xs text-[#aab1ad]">
              Description
            </span>
            <textarea
              className={`${inputClass} min-h-28 resize-y py-3`}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              value={form.description}
            />
          </label>
        </div>
        <FormActions busy={busy} label="Save changes" onClose={onClose} />
      </form>
    </Modal>
  );
}

function CloseOpportunityDialog({
  opportunity,
  onClose,
  onSaved,
}: {
  opportunity: OpportunityDetail;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    outcome: "won" as "won" | "lost",
    closing_reason: "",
    closing_notes: "",
    amount: opportunity.amount === null ? "" : String(opportunity.amount ?? ""),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(`/api/opportunities/${opportunity.opportunity_id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: form.outcome,
          closing_reason: form.closing_reason || null,
          closing_notes: form.closing_notes || null,
          ...(form.amount ? { amount: Number(form.amount) } : {}),
        }),
      });
      toast.success(`Opportunity closed as ${form.outcome}`);
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to close opportunity",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      description="Record the final result without losing the sales history."
      onClose={onClose}
      title="Close opportunity"
    >
      <form className="p-6" onSubmit={submit}>
        <div className="grid grid-cols-2 gap-2">
          {(["won", "lost"] as const).map((outcome) => (
            <button
              className={`flex h-12 items-center justify-center gap-2 rounded-lg border text-sm font-semibold capitalize transition ${
                form.outcome === outcome
                  ? outcome === "won"
                    ? "border-[#48c49f]/45 bg-[#173a30] text-[#8ae2c7]"
                    : "border-[#e46e67]/45 bg-[#3d211f] text-[#f3aaa5]"
                  : "border-white/[0.1] text-[#8c9490] hover:bg-white/[0.04]"
              }`}
              key={outcome}
              onClick={() => setForm((current) => ({ ...current, outcome }))}
              type="button"
            >
              {outcome === "won" ? (
                <CircleCheck className="size-4" />
              ) : (
                <XCircle className="size-4" />
              )}
              {outcome}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs text-[#aab1ad]">
              Final value
            </span>
            <input
              className={inputClass}
              min="0"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  amount: event.target.value,
                }))
              }
              type="number"
              value={form.amount}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs text-[#aab1ad]">
              Closing reason
            </span>
            <input
              className={inputClass}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  closing_reason: event.target.value,
                }))
              }
              placeholder={
                form.outcome === "won"
                  ? "Customer confirmed booking"
                  : "Reason the deal was lost"
              }
              value={form.closing_reason}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs text-[#aab1ad]">Notes</span>
            <textarea
              className={`${inputClass} min-h-24 resize-y py-3`}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  closing_notes: event.target.value,
                }))
              }
              value={form.closing_notes}
            />
          </label>
        </div>
        <FormActions
          busy={busy}
          label={`Close as ${form.outcome}`}
          onClose={onClose}
        />
      </form>
    </Modal>
  );
}

function SiteVisitDialog({
  opportunity,
  onClose,
  onSaved,
}: {
  opportunity: OpportunityDetail;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(11, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60_000);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: `Site visit · ${personName(opportunity.contact?.first_name, opportunity.contact?.last_name)}`,
    starts_at: toLocalInput(start),
    ends_at: toLocalInput(end),
    location: opportunity.project_name,
    arrival_instructions: "",
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/api/site-visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: opportunity.project_id,
          opportunity_id: opportunity.opportunity_id,
          title: form.title,
          starts_at: new Date(form.starts_at).toISOString(),
          ends_at: new Date(form.ends_at).toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          location: form.location || null,
          arrival_instructions: form.arrival_instructions || null,
        }),
      });
      toast.success("Site visit scheduled");
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to schedule site visit",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      description="This visit will also appear in Calendar and the opportunity timeline."
      onClose={onClose}
      title="Schedule site visit"
    >
      <form className="p-6" onSubmit={submit}>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs text-[#aab1ad]">Title</span>
            <input
              className={inputClass}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              required
              value={form.title}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mb-2 block text-xs text-[#aab1ad]">Starts</span>
              <input
                className={inputClass}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    starts_at: event.target.value,
                  }))
                }
                required
                type="datetime-local"
                value={form.starts_at}
              />
            </label>
            <label>
              <span className="mb-2 block text-xs text-[#aab1ad]">Ends</span>
              <input
                className={inputClass}
                min={form.starts_at}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    ends_at: event.target.value,
                  }))
                }
                required
                type="datetime-local"
                value={form.ends_at}
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-2 block text-xs text-[#aab1ad]">Location</span>
            <input
              className={inputClass}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  location: event.target.value,
                }))
              }
              value={form.location}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs text-[#aab1ad]">
              Arrival instructions
            </span>
            <textarea
              className={`${inputClass} min-h-24 resize-y py-3`}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  arrival_instructions: event.target.value,
                }))
              }
              value={form.arrival_instructions}
            />
          </label>
        </div>
        <FormActions busy={busy} label="Schedule visit" onClose={onClose} />
      </form>
    </Modal>
  );
}

function QuoteDialog({
  opportunity,
  shortlist,
  onClose,
  onSaved,
}: {
  opportunity: OpportunityDetail;
  shortlist: Shortlist;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const valid = new Date();
  valid.setDate(valid.getDate() + 14);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    valid_until: valid.toISOString().slice(0, 10),
    tax_amount: "0",
    notes: "",
  });
  const subtotal = shortlist.items.reduce(
    (sum, item) => sum + Number(item.amount ?? 0),
    0,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(`/api/opportunities/${opportunity.opportunity_id}/quotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shortlist_id: shortlist.shortlist_id,
          valid_until: form.valid_until || null,
          tax_amount: Number(form.tax_amount || 0),
          notes: form.notes || null,
        }),
      });
      toast.success("Quotation created");
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to create quotation",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      description={`Based on ${shortlist.title} and its captured effective prices.`}
      onClose={onClose}
      title="Create quotation"
    >
      <form className="p-6" onSubmit={submit}>
        <div className="mb-5 flex items-center justify-between border-y border-white/[0.08] py-4">
          <span className="text-sm text-[#8f9792]">
            {shortlist.items.length} unit
            {shortlist.items.length === 1 ? "" : "s"}
          </span>
          <strong className="text-lg text-white">
            {formatMoney(subtotal, shortlist.items[0]?.currency ?? "INR")}
          </strong>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="mb-2 block text-xs text-[#aab1ad]">
              Valid until
            </span>
            <input
              className={inputClass}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  valid_until: event.target.value,
                }))
              }
              type="date"
              value={form.valid_until}
            />
          </label>
          <label>
            <span className="mb-2 block text-xs text-[#aab1ad]">
              Tax amount
            </span>
            <input
              className={inputClass}
              min="0"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  tax_amount: event.target.value,
                }))
              }
              type="number"
              value={form.tax_amount}
            />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-2 block text-xs text-[#aab1ad]">Notes</span>
            <textarea
              className={`${inputClass} min-h-24 resize-y py-3`}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              value={form.notes}
            />
          </label>
        </div>
        <FormActions busy={busy} label="Create quotation" onClose={onClose} />
      </form>
    </Modal>
  );
}

function OpportunityCard({
  opportunity,
  onOpen,
}: {
  opportunity: Opportunity;
  onOpen: (opportunity: Opportunity) => void;
}) {
  const contact = personName(opportunity.first_name, opportunity.last_name);
  return (
    <button
      className="group w-full cursor-grab border-b border-white/[0.07] px-3 py-4 text-left transition hover:bg-white/[0.025] active:cursor-grabbing"
      draggable={opportunity.status === "open"}
      onClick={() => onOpen(opportunity)}
      onDragStart={(event) => {
        event.dataTransfer.setData(
          "text/opportunity-id",
          opportunity.opportunity_id,
        );
        event.dataTransfer.effectAllowed = "move";
      }}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <strong className="block truncate text-sm font-semibold text-[#e9ecea]">
            {contact}
          </strong>
          <span className="mt-1 block truncate text-[11px] text-[#6f7773]">
            {opportunity.project_name}
          </span>
        </span>
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-[#4f5753] transition group-hover:translate-x-0.5 group-hover:text-[#8f9792]" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <span>
          <strong className="block text-sm font-semibold text-[#dfe3e0]">
            {formatMoney(opportunity.amount)}
          </strong>
          <span className="mt-1 block text-[10px] text-[#69716d]">
            {opportunity.probability}% probability
          </span>
        </span>
        <span className="text-right text-[10px] text-[#69716d]">
          {opportunity.expected_close_date
            ? formatDate(opportunity.expected_close_date)
            : "No close date"}
        </span>
      </div>
    </button>
  );
}

export function OpportunityWorkspace() {
  const router = useRouter();
  const [context, setContext] = useState<ProjectContext | null>(null);
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [requestedLeadId, setRequestedLeadId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("pipeline");
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [stages, setStages] = useState<OpportunityStage[]>(FALLBACK_STAGES);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("overview");
  const [detailLoading, setDetailLoading] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [shortlists, setShortlists] = useState<Shortlist[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [siteVisits, setSiteVisits] = useState<SiteVisit[]>([]);
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [unitQuery, setUnitQuery] = useState("");
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [dialog, setDialog] = useState<"edit" | "close" | "visit" | null>(null);
  const [quoteShortlist, setQuoteShortlist] = useState<Shortlist | null>(null);

  useEffect(() => {
    let active = true;
    void api<ProjectContext>("/api/auth/project-context")
      .then((payload) => {
        if (!active) return;
        setContext(payload);
        const projects = payload.projects ?? [];
        const requested = new URLSearchParams(window.location.search).get(
          "project_id",
        );
        const stored = window.localStorage.getItem("sthyra-project-id");
        const available = new Set(
          projects.map((project) => String(project.project_id)),
        );
        const initial =
          requested && available.has(requested)
            ? requested
            : stored && available.has(stored)
              ? stored
              : payload.can_view_all_projects
                ? "all"
                : String(projects[0]?.project_id ?? "");
        setProjectFilter(initial);
        const requestedOpportunity = new URLSearchParams(
          window.location.search,
        ).get("opportunity_id");
        if (requestedOpportunity) setSelectedId(requestedOpportunity);
        const requestedLead = new URLSearchParams(window.location.search).get(
          "lead_id",
        );
        if (requestedLead) {
          setRequestedLeadId(requestedLead);
          setStatusFilter("all");
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

  const loadOpportunities = useCallback(
    async (quiet = false) => {
      if (!projectFilter) return;
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: "100" });
        if (projectFilter !== "all") params.set("project_id", projectFilter);
        if (statusFilter !== "all") params.set("status", statusFilter);
        if (requestedLeadId) params.set("lead_id", requestedLeadId);
        if (query.trim()) params.set("search", query.trim());
        const payload = await api<{
          opportunities?: Opportunity[];
          stages?: OpportunityStageApi[];
        }>(`/api/opportunities?${params.toString()}`);
        setOpportunities(payload.opportunities ?? []);
        if (payload.stages?.length) {
          setStages(
            payload.stages.map((stage) => ({
              key: stage.stage_key,
              label: stage.stage_name,
              position: Number(stage.position),
              probability: Number(stage.probability),
              color: stage.color,
              isInitial: stage.is_initial,
            })),
          );
        }
        if (requestedLeadId && payload.opportunities?.[0])
          setSelectedId(payload.opportunities[0].opportunity_id);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to load opportunities",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectFilter, query, requestedLeadId, statusFilter],
  );

  useEffect(() => {
    const task = window.setTimeout(() => void loadOpportunities(), 220);
    return () => window.clearTimeout(task);
  }, [loadOpportunities]);

  const loadRelated = useCallback(async (opportunity: OpportunityDetail) => {
    setRelatedLoading(true);
    try {
      const [timelineData, shortlistData, quoteData, visitData, unitData] =
        await Promise.all([
          api<{ events?: TimelineEvent[] }>(
            `/api/opportunities/${opportunity.opportunity_id}/timeline?limit=100`,
          ),
          api<{ shortlists?: Shortlist[] }>(
            `/api/opportunities/${opportunity.opportunity_id}/shortlists?limit=100`,
          ),
          api<{ quotations?: Quotation[] }>(
            `/api/opportunities/${opportunity.opportunity_id}/quotations?limit=100`,
          ),
          api<{ site_visits?: SiteVisit[] }>(
            `/api/opportunities/${opportunity.opportunity_id}/site-visits?limit=100`,
          ),
          api<{ units?: InventoryUnit[] }>(
            `/api/inventory/units?project_id=${opportunity.project_id}&limit=200`,
          ),
        ]);
      setTimeline(timelineData.events ?? []);
      setShortlists(shortlistData.shortlists ?? []);
      setQuotations(quoteData.quotations ?? []);
      setSiteVisits(visitData.site_visits ?? []);
      setUnits(unitData.units ?? []);
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Unable to load opportunity activity",
      );
    } finally {
      setRelatedLoading(false);
    }
  }, []);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      try {
        const payload = await api<{ opportunity?: OpportunityDetail }>(
          `/api/opportunities/${id}`,
        );
        const opportunity = payload.opportunity ?? null;
        setDetail(opportunity);
        if (opportunity) await loadRelated(opportunity);
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : "Unable to load opportunity",
        );
        setSelectedId(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [loadRelated],
  );

  useEffect(() => {
    if (!selectedId) return;
    const task = window.setTimeout(() => void loadDetail(selectedId), 0);
    return () => window.clearTimeout(task);
  }, [loadDetail, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !dialog && !quoteShortlist) closeDrawer();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  });

  function openOpportunity(opportunity: Opportunity) {
    setSelectedId(opportunity.opportunity_id);
    setDrawerTab("overview");
    const url = new URL(window.location.href);
    url.searchParams.set("opportunity_id", opportunity.opportunity_id);
    window.history.replaceState(null, "", url);
  }

  function closeDrawer() {
    setSelectedId(null);
    setDetail(null);
    setSelectedUnitIds([]);
    const url = new URL(window.location.href);
    url.searchParams.delete("opportunity_id");
    window.history.replaceState(null, "", url);
  }

  async function refreshSelected() {
    await Promise.all([
      loadOpportunities(true),
      selectedId ? loadDetail(selectedId) : Promise.resolve(),
    ]);
  }

  async function changeStage(opportunityId: string, stageKey: string) {
    const current = opportunities.find(
      (item) => item.opportunity_id === opportunityId,
    );
    if (!current || current.stage_key === stageKey || current.status !== "open")
      return;
    setActionBusy(true);
    try {
      await api(`/api/opportunities/${opportunityId}/change-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_key: stageKey }),
      });
      toast.success(`Moved to ${stageLabel(stageKey, stages)}`);
      await refreshSelected();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Unable to change stage",
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function reopenOpportunity() {
    if (!detail) return;
    setActionBusy(true);
    try {
      await api(`/api/opportunities/${detail.opportunity_id}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Reopened from opportunity workspace" }),
      });
      toast.success("Opportunity reopened");
      await refreshSelected();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Unable to reopen opportunity",
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function createShortlist() {
    if (!detail || !selectedUnitIds.length) return;
    setActionBusy(true);
    try {
      await api(`/api/opportunities/${detail.opportunity_id}/shortlists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Selection · ${formatDate(new Date().toISOString())}`,
          unit_ids: selectedUnitIds,
        }),
      });
      setSelectedUnitIds([]);
      toast.success("Inventory shortlist saved with current prices");
      await loadRelated(detail);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Unable to create shortlist",
      );
    } finally {
      setActionBusy(false);
    }
  }

  const pipelineStages = useMemo(() => {
    const unknown = opportunities
      .map((item) => item.stage_key)
      .filter((key) => !stages.some((stage) => stage.key === key));
    return [
      ...stages,
      ...[...new Set(unknown)].map((key) => ({
        key,
        label: stageLabel(key, stages),
        position: Number.MAX_SAFE_INTEGER,
        probability: 0,
        color: "#87908b",
        isInitial: false,
      })),
    ];
  }, [opportunities, stages]);

  const metrics = useMemo(() => {
    const open = opportunities.filter((item) => item.status === "open");
    return {
      total: opportunities.length,
      open: open.length,
      pipeline: open.reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
      weighted: open.reduce(
        (sum, item) =>
          sum + Number(item.amount ?? 0) * (item.probability / 100),
        0,
      ),
    };
  }, [opportunities]);

  const visibleUnits = useMemo(() => {
    const normalized = unitQuery.trim().toLowerCase();
    return units.filter(
      (unit) =>
        !normalized ||
        unit.unit_code.toLowerCase().includes(normalized) ||
        (unit.unit_name ?? "").toLowerCase().includes(normalized) ||
        (unit.type_name ?? "").toLowerCase().includes(normalized),
    );
  }, [unitQuery, units]);

  return (
    <main className="min-h-dvh bg-[#050706] text-[#f5f5f5]">
      <DashboardSidebar />
      <section className="ml-[96px] min-h-dvh py-7 pr-7 pb-8 max-[780px]:py-5 max-[780px]:pr-4 max-[560px]:ml-[84px] max-[560px]:px-3">
        <header className="flex flex-wrap items-end justify-between gap-5 pb-6">
          <div>
            <p className="text-[11px] text-[#6e7672]">
              {context?.company?.company_name ?? "Workspace"} / Revenue
            </p>
            <h1 className="mt-2 font-[var(--font-bricolage)] text-[clamp(30px,3vw,42px)] font-medium tracking-[-0.035em]">
              Opportunities
            </h1>
            <p className="mt-2 text-sm text-[#8b928f]">
              Qualified demand, inventory choices and every next step in one
              view.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              aria-label="Refresh opportunities"
              className="grid size-9 place-items-center text-[#747c78] transition hover:text-white"
              disabled={refreshing}
              onClick={() => void loadOpportunities(true)}
              type="button"
            >
              <RefreshCw
                className={`size-4 ${refreshing ? "animate-spin" : ""}`}
              />
            </button>
            <div className="flex items-center gap-5">
              <button
                className={`flex h-9 items-center gap-1.5 border-b-2 px-0.5 text-xs transition ${view === "pipeline" ? "border-[#4bc49f] text-white" : "border-transparent text-[#747c78] hover:text-[#c3c9c5]"}`}
                onClick={() => setView("pipeline")}
                type="button"
              >
                <KanbanSquare className="size-3.5" /> Pipeline
              </button>
              <button
                className={`flex h-9 items-center gap-1.5 border-b-2 px-0.5 text-xs transition ${view === "list" ? "border-[#4bc49f] text-white" : "border-transparent text-[#747c78] hover:text-[#c3c9c5]"}`}
                onClick={() => setView("list")}
                type="button"
              >
                <LayoutList className="size-3.5" /> List
              </button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-4 border-y border-white/[0.08] max-[860px]:grid-cols-2 max-[520px]:grid-cols-1">
          {[
            ["Open opportunities", String(metrics.open)],
            ["Pipeline value", formatMoney(metrics.pipeline)],
            ["Weighted value", formatMoney(metrics.weighted)],
            ["Visible records", String(metrics.total)],
          ].map(([label, metric], index) => (
            <div
              className={`py-4 ${index ? "border-l border-white/[0.08] pl-5 max-[520px]:border-l-0 max-[520px]:pl-0" : ""}`}
              key={label}
            >
              <span className="block text-[10px] font-medium tracking-[0.04em] text-[#68706c] uppercase">
                {label}
              </span>
              <strong className="mt-1.5 block text-lg font-semibold tracking-[-0.01em] text-[#edf0ee]">
                {metric}
              </strong>
            </div>
          ))}
        </section>

        <section className="flex flex-wrap items-center gap-3 border-b border-white/[0.08] py-4">
          <label className="relative min-w-[260px] flex-1">
            <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#68706c]" />
            <input
              className="h-10 w-full border-0 border-b border-white/[0.12] bg-transparent pr-3 pl-10 text-xs text-white outline-none placeholder:text-[#5b625e] focus:border-[#50c4a2]/60"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search opportunity, contact or email"
              value={query}
            />
          </label>
          <label className="relative">
            <select
              className="h-10 min-w-44 appearance-none border-0 border-b border-white/[0.12] bg-transparent pr-9 pl-1 text-xs text-[#d7dcda] outline-none focus:border-[#50c4a2]/60"
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
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-[#747c78]" />
          </label>
          <label className="relative">
            <select
              className="h-10 min-w-32 appearance-none border-0 border-b border-white/[0.12] bg-transparent pr-9 pl-1 text-xs text-[#d7dcda] outline-none focus:border-[#50c4a2]/60"
              onChange={(event) => setStatusFilter(event.target.value)}
              value={statusFilter}
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-[#747c78]" />
          </label>
        </section>

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center gap-3 text-sm text-[#747c78]">
            <LoaderCircle className="size-5 animate-spin" /> Loading
            opportunities…
          </div>
        ) : error ? (
          <EmptyState
            action={() => void loadOpportunities()}
            actionLabel="Try again"
            description={error}
            icon={CircleAlert}
            title="Opportunities could not be loaded"
          />
        ) : !opportunities.length ? (
          <EmptyState
            description="An opportunity is created automatically and exactly once when a lead is qualified."
            icon={Target}
            title="No opportunities match these filters"
          />
        ) : view === "pipeline" ? (
          <section className="overflow-x-auto pt-5 [scrollbar-color:#303633_transparent] [scrollbar-width:thin]">
            <div className="grid min-w-max auto-cols-[285px] grid-flow-col border-y border-white/[0.08]">
              {pipelineStages.map((stage) => {
                const items = opportunities.filter(
                  (opportunity) => opportunity.stage_key === stage.key,
                );
                const value = items.reduce(
                  (sum, item) => sum + Number(item.amount ?? 0),
                  0,
                );
                return (
                  <div
                    className="min-h-[520px] border-l border-white/[0.08] first:border-l-0"
                    key={stage.key}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event: DragEvent<HTMLDivElement>) => {
                      event.preventDefault();
                      const id = event.dataTransfer.getData(
                        "text/opportunity-id",
                      );
                      if (id) void changeStage(id, stage.key);
                    }}
                  >
                    <header className="border-b border-white/[0.08] px-3 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-xs font-semibold text-[#dfe3e0]">
                          <i
                            className="size-2 rounded-full"
                            style={{ backgroundColor: stage.color }}
                          />
                          {stage.label}
                        </span>
                        <span className="text-[10px] tabular-nums text-[#69716d]">
                          {items.length}
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] text-[#68706c]">
                        {formatMoney(value)}
                      </p>
                    </header>
                    <div>
                      {items.map((opportunity) => (
                        <OpportunityCard
                          key={opportunity.opportunity_id}
                          onOpen={openOpportunity}
                          opportunity={opportunity}
                        />
                      ))}
                      {!items.length && (
                        <p className="px-3 py-5 text-[11px] text-[#4f5753]">
                          No opportunities
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="pt-5">
            <div className="overflow-x-auto border-y border-white/[0.08]">
              <table className="w-full min-w-[960px] border-collapse text-left">
                <thead className="bg-white/[0.025] text-[10px] tracking-[0.08em] text-[#68706c] uppercase">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Opportunity</th>
                    <th className="px-4 py-3 font-semibold">Project</th>
                    <th className="px-4 py-3 font-semibold">Stage</th>
                    <th className="px-4 py-3 font-semibold">Value</th>
                    <th className="px-4 py-3 font-semibold">Probability</th>
                    <th className="px-4 py-3 font-semibold">Expected close</th>
                    <th className="px-4 py-3 font-semibold">Owner</th>
                    <th className="w-10 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.07]">
                  {opportunities.map((opportunity) => (
                    <tr
                      className="cursor-pointer transition hover:bg-white/[0.025]"
                      key={opportunity.opportunity_id}
                      onClick={() => openOpportunity(opportunity)}
                    >
                      <td className="px-4 py-4">
                        <strong className="block text-sm text-[#e4e8e5]">
                          {personName(
                            opportunity.first_name,
                            opportunity.last_name,
                          )}
                        </strong>
                        <span className="mt-1 block text-[11px] text-[#68706c]">
                          {opportunity.email ?? opportunity.opportunity_name}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-xs text-[#aab1ad]">
                        {opportunity.project_name}
                      </td>
                      <td className="px-4 py-4">
                        <span className="rounded-full border border-white/[0.09] bg-white/[0.04] px-2.5 py-1 text-[10px] text-[#b7bdb9]">
                          {opportunity.status === "closed"
                            ? opportunity.outcome
                            : stageLabel(opportunity.stage_key, pipelineStages)}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-xs font-semibold text-[#dfe3e0]">
                        {formatMoney(opportunity.amount)}
                      </td>
                      <td className="px-4 py-4 text-xs text-[#9da5a1]">
                        {opportunity.probability}%
                      </td>
                      <td className="px-4 py-4 text-xs text-[#9da5a1]">
                        {formatDate(opportunity.expected_close_date)}
                      </td>
                      <td className="px-4 py-4 text-xs text-[#9da5a1]">
                        {personName(
                          opportunity.owner_first_name,
                          opportunity.owner_last_name,
                          opportunity.team_name ?? "Unassigned",
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <ChevronRight className="size-4 text-[#555d59]" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </section>

      {selectedId && (
        <>
          <button
            aria-label="Close opportunity details"
            className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-[2px]"
            onClick={closeDrawer}
            type="button"
          />
          <aside className="fixed inset-y-3 right-3 z-[70] flex w-[min(860px,calc(100vw-112px))] flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0e1210] shadow-[-30px_0_90px_rgba(0,0,0,.55)] max-[560px]:inset-2 max-[560px]:w-auto">
            {detailLoading || !detail ? (
              <div className="flex flex-1 items-center justify-center gap-3 text-sm text-[#7d8581]">
                <LoaderCircle className="size-5 animate-spin" /> Loading
                opportunity…
              </div>
            ) : (
              <>
                <header className="shrink-0 border-b border-white/[0.09] px-6 pt-5">
                  <div className="flex items-start justify-between gap-5 pb-5">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold tracking-[0.16em] text-[#69716d] uppercase">
                        Opportunity
                      </p>
                      <h2 className="mt-2 truncate font-[var(--font-bricolage)] text-2xl font-semibold tracking-[-0.025em] text-white">
                        {detail.opportunity_name}
                      </h2>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#89918d]">
                        <span>{detail.project_name}</span>
                        <span>·</span>
                        <span className="capitalize">
                          {detail.status === "closed"
                            ? detail.outcome
                            : stageLabel(detail.stage_key, pipelineStages)}
                        </span>
                        <span>·</span>
                        <span>{formatMoney(detail.amount)}</span>
                      </div>
                    </div>
                    <button
                      aria-label="Close"
                      className="grid size-9 shrink-0 place-items-center rounded-lg text-[#89918d] hover:bg-white/[0.06] hover:text-white"
                      onClick={closeDrawer}
                      type="button"
                    >
                      <X className="size-5" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] py-3">
                    {detail.status === "open" ? (
                      <>
                        <button
                          className="flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.11] px-3 text-xs font-medium text-[#d6dbd8] hover:bg-white/[0.05]"
                          onClick={() => setDialog("edit")}
                          type="button"
                        >
                          <Pencil className="size-3.5" /> Edit
                        </button>
                        <label className="relative">
                          <select
                            className="h-9 appearance-none rounded-lg border border-white/[0.11] bg-[#111512] pr-8 pl-3 text-xs text-[#d6dbd8] outline-none"
                            disabled={actionBusy}
                            onChange={(event) =>
                              void changeStage(
                                detail.opportunity_id,
                                event.target.value,
                              )
                            }
                            value={detail.stage_key}
                          >
                            {pipelineStages.map((stage) => (
                              <option key={stage.key} value={stage.key}>
                                {stage.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-[#727a76]" />
                        </label>
                        <button
                          className="flex h-9 items-center gap-1.5 rounded-lg border border-[#ca776f]/25 bg-[#3a211f]/45 px-3 text-xs font-medium text-[#eaa09a] hover:bg-[#492724]"
                          onClick={() => setDialog("close")}
                          type="button"
                        >
                          <CircleCheck className="size-3.5" /> Close opportunity
                        </button>
                      </>
                    ) : (
                      <button
                        className="flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.11] px-3 text-xs font-medium text-[#d6dbd8] hover:bg-white/[0.05]"
                        disabled={actionBusy}
                        onClick={() => void reopenOpportunity()}
                        type="button"
                      >
                        <RotateCcw className="size-3.5" /> Reopen
                      </button>
                    )}
                    <Link
                      className="ml-auto flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 text-xs text-[#aab1ad] hover:bg-white/[0.05] hover:text-white"
                      href={`/leads?lead_id=${detail.lead_id}`}
                    >
                      View lead <ExternalLink className="size-3.5" />
                    </Link>
                  </div>
                  <nav className="flex gap-6 overflow-x-auto [scrollbar-width:none]">
                    {(
                      [
                        ["overview", "Overview"],
                        ["timeline", "Timeline"],
                        ["inventory", "Inventory"],
                        ["visits", "Site visits"],
                        ["quotes", "Quotations"],
                      ] as Array<[DrawerTab, string]>
                    ).map(([tab, label]) => (
                      <button
                        className={`shrink-0 border-b-2 px-0.5 py-3 text-xs font-medium ${drawerTab === tab ? "border-[#4bc49f] text-white" : "border-transparent text-[#7d8581] hover:text-[#c7cdca]"}`}
                        key={tab}
                        onClick={() => setDrawerTab(tab)}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </nav>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 [scrollbar-color:#303733_transparent] [scrollbar-width:thin]">
                  {relatedLoading && drawerTab !== "overview" && (
                    <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-[#727a76]">
                      <LoaderCircle className="size-4 animate-spin" /> Loading…
                    </div>
                  )}
                  {drawerTab === "overview" && (
                    <div className="space-y-8">
                      <section>
                        <h3 className="text-xs font-semibold tracking-[0.1em] text-[#6f7773] uppercase">
                          Contact
                        </h3>
                        <div className="mt-4 flex items-center gap-4 border-y border-white/[0.08] py-4">
                          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#1b4b3d] text-sm font-semibold text-[#96e4cc]">
                            {personName(
                              detail.contact?.first_name,
                              detail.contact?.last_name,
                            )
                              .split(" ")
                              .map((part) => part[0])
                              .join("")
                              .slice(0, 2)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <strong className="block text-sm text-[#e5e9e6]">
                              {personName(
                                detail.contact?.first_name,
                                detail.contact?.last_name,
                              )}
                            </strong>
                            <span className="mt-1 block truncate text-xs text-[#747c78]">
                              {detail.contact?.email ??
                                detail.contact?.phone_number ??
                                "No contact details"}
                            </span>
                          </span>
                          <Link
                            className="text-xs font-semibold text-[#68d5b4] hover:text-[#9be8d2]"
                            href={`/leads?lead_id=${detail.lead_id}`}
                          >
                            Open lead
                          </Link>
                        </div>
                      </section>
                      <section>
                        <h3 className="text-xs font-semibold tracking-[0.1em] text-[#6f7773] uppercase">
                          Commercial details
                        </h3>
                        <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-6 border-y border-white/[0.08] py-5 max-[520px]:grid-cols-1">
                          {[
                            ["Opportunity value", formatMoney(detail.amount)],
                            ["Probability", `${detail.probability}%`],
                            [
                              "Expected close",
                              formatDate(detail.expected_close_date),
                            ],
                            [
                              "Qualified",
                              formatDate(detail.qualified_at, true),
                            ],
                            [
                              "Owner",
                              detail.owner
                                ? personName(
                                    detail.owner.first_name,
                                    detail.owner.last_name,
                                  )
                                : (detail.team?.team_name ?? "Unassigned"),
                            ],
                            [
                              "Project",
                              `${detail.project_name} · ${detail.project_code}`,
                            ],
                          ].map(([label, item]) => (
                            <div key={label}>
                              <dt className="text-[10px] tracking-[0.09em] text-[#68706c] uppercase">
                                {label}
                              </dt>
                              <dd className="mt-1.5 text-sm text-[#d8ddda]">
                                {item}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                      {detail.description && (
                        <section>
                          <h3 className="text-xs font-semibold tracking-[0.1em] text-[#6f7773] uppercase">
                            Description
                          </h3>
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#b2b9b5]">
                            {detail.description}
                          </p>
                        </section>
                      )}
                      {detail.status === "closed" && (
                        <section className="border-y border-white/[0.08] py-5">
                          <p className="text-xs font-semibold tracking-[0.1em] text-[#6f7773] uppercase">
                            Closing summary
                          </p>
                          <p className="mt-3 text-sm capitalize text-[#dce1de]">
                            {detail.outcome} ·{" "}
                            {detail.closing_reason || "No reason recorded"}
                          </p>
                          {detail.closing_notes && (
                            <p className="mt-2 text-sm leading-6 text-[#89918d]">
                              {detail.closing_notes}
                            </p>
                          )}
                        </section>
                      )}
                    </div>
                  )}

                  {!relatedLoading &&
                    drawerTab === "timeline" &&
                    (timeline.length ? (
                      <div className="space-y-0">
                        {timeline.map((event, index) => (
                          <div
                            className="relative flex gap-4 pb-7"
                            key={event.event_id}
                          >
                            {index < timeline.length - 1 && (
                              <i className="absolute top-7 bottom-0 left-[11px] w-px bg-white/[0.09]" />
                            )}
                            <span className="relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-white/[0.12] bg-[#111512]">
                              <i className="size-1.5 rounded-full bg-[#55cdaa]" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-[#dce1de]">
                                {stageLabel(event.event_type)}
                              </p>
                              <p className="mt-1 text-xs text-[#68706c]">
                                {formatDate(event.occurred_at, true)}
                              </p>
                              {typeof event.data.title === "string" && (
                                <p className="mt-2 text-sm text-[#939b97]">
                                  {event.data.title}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        description="Stage, ownership, visits, shortlists and quotations will appear here."
                        icon={Clock3}
                        title="No timeline events"
                      />
                    ))}

                  {!relatedLoading && drawerTab === "inventory" && (
                    <div>
                      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.08] pb-5">
                        <div>
                          <h3 className="text-base font-semibold text-[#e7ebe8]">
                            Inventory shortlist
                          </h3>
                          <p className="mt-1 text-xs text-[#747c78]">
                            Prices are captured from the current effective price
                            book.
                          </p>
                        </div>
                        <Link
                          className="flex items-center gap-1.5 text-xs font-semibold text-[#68d5b4]"
                          href={`/inventory?project_id=${detail.project_id}`}
                        >
                          Open inventory <ExternalLink className="size-3.5" />
                        </Link>
                      </div>
                      {shortlists.length > 0 && (
                        <div className="border-b border-white/[0.08] py-5">
                          <p className="mb-3 text-[10px] font-semibold tracking-[0.1em] text-[#69716d] uppercase">
                            Saved selections
                          </p>
                          <div className="space-y-2">
                            {shortlists.map((shortlist) => (
                              <div
                                className="flex items-center gap-3 rounded-lg bg-white/[0.025] px-3 py-3"
                                key={shortlist.shortlist_id}
                              >
                                <PackageCheck className="size-4 shrink-0 text-[#69d5b5]" />
                                <span className="min-w-0 flex-1">
                                  <strong className="block truncate text-xs text-[#dce1de]">
                                    {shortlist.title}
                                  </strong>
                                  <span className="mt-0.5 block text-[10px] text-[#68706c]">
                                    {shortlist.items.length} unit
                                    {shortlist.items.length === 1
                                      ? ""
                                      : "s"} ·{" "}
                                    {formatMoney(
                                      shortlist.items.reduce(
                                        (sum, item) =>
                                          sum + Number(item.amount ?? 0),
                                        0,
                                      ),
                                      shortlist.items[0]?.currency ?? "INR",
                                    )}
                                  </span>
                                </span>
                                <button
                                  className="text-[10px] font-semibold text-[#67d3b2]"
                                  onClick={() => setQuoteShortlist(shortlist)}
                                  type="button"
                                >
                                  Create quote
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-3 py-4">
                        <label className="relative min-w-[220px] flex-1">
                          <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[#68706c]" />
                          <input
                            className="h-9 w-full rounded-lg border border-white/[0.09] bg-[#0b0e0c] pr-3 pl-9 text-xs text-white outline-none"
                            onChange={(event) =>
                              setUnitQuery(event.target.value)
                            }
                            placeholder="Search project inventory"
                            value={unitQuery}
                          />
                        </label>
                        <button
                          className="flex h-9 items-center gap-1.5 rounded-lg bg-[#2b8d70] px-3 text-xs font-semibold text-white disabled:opacity-45"
                          disabled={!selectedUnitIds.length || actionBusy}
                          onClick={() => void createShortlist()}
                          type="button"
                        >
                          {actionBusy ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <Plus className="size-3.5" />
                          )}
                          Save{" "}
                          {selectedUnitIds.length
                            ? `${selectedUnitIds.length} `
                            : ""}
                          to shortlist
                        </button>
                      </div>
                      <div className="divide-y divide-white/[0.07] border-y border-white/[0.08]">
                        {visibleUnits.map((unit) => {
                          const selected = selectedUnitIds.includes(
                            unit.unit_id,
                          );
                          const selectable =
                            unit.status === "available" || selected;
                          return (
                            <label
                              className={`flex items-center gap-3 py-3.5 ${selectable ? "cursor-pointer" : "opacity-45"}`}
                              key={unit.unit_id}
                            >
                              <input
                                checked={selected}
                                className="accent-[#4dc6a3]"
                                disabled={!selectable}
                                onChange={(event) =>
                                  setSelectedUnitIds((current) =>
                                    event.target.checked
                                      ? [...current, unit.unit_id]
                                      : current.filter(
                                          (id) => id !== unit.unit_id,
                                        ),
                                  )
                                }
                                type="checkbox"
                              />
                              <span className="min-w-0 flex-1">
                                <strong className="block truncate text-xs text-[#dce1de]">
                                  {unit.unit_code}
                                  {unit.unit_name ? ` · ${unit.unit_name}` : ""}
                                </strong>
                                <span className="mt-1 block text-[10px] text-[#69716d]">
                                  {unit.type_name ?? unit.type_code ?? "Unit"}
                                  {unit.area_sqft
                                    ? ` · ${Number(unit.area_sqft).toLocaleString("en-IN")} sq ft`
                                    : ""}
                                </span>
                              </span>
                              <span className="text-right">
                                <strong className="block text-xs text-[#d7dcd9]">
                                  {formatMoney(
                                    unit.effective_price,
                                    unit.effective_price_currency ?? "INR",
                                  )}
                                </strong>
                                <span className="mt-1 block text-[10px] capitalize text-[#68706c]">
                                  {unit.status}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      {!visibleUnits.length && (
                        <EmptyState
                          description="Add available units and pricing to this project first."
                          icon={PackageCheck}
                          title="No matching inventory"
                        />
                      )}
                    </div>
                  )}

                  {!relatedLoading && drawerTab === "visits" && (
                    <div>
                      <div className="flex items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
                        <div>
                          <h3 className="text-base font-semibold text-[#e7ebe8]">
                            Site visits
                          </h3>
                          <p className="mt-1 text-xs text-[#747c78]">
                            Visits stay synchronized with Calendar.
                          </p>
                        </div>
                        <button
                          className="flex h-9 items-center gap-1.5 rounded-lg bg-[#2b8d70] px-3 text-xs font-semibold text-white"
                          onClick={() => setDialog("visit")}
                          type="button"
                        >
                          <Plus className="size-3.5" /> Schedule
                        </button>
                      </div>
                      {siteVisits.length ? (
                        <div className="divide-y divide-white/[0.07]">
                          {siteVisits.map((visit) => (
                            <div
                              className="flex items-center gap-4 py-4"
                              key={visit.visit_id ?? visit.appointment_id}
                            >
                              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#3a2a14] text-[#efbb67]">
                                <MapPin className="size-[18px]" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <strong className="block truncate text-sm text-[#dfe3e0]">
                                  {visit.title}
                                </strong>
                                <span className="mt-1 block text-xs text-[#727a76]">
                                  {formatDate(visit.starts_at, true)}
                                  {visit.location ? ` · ${visit.location}` : ""}
                                </span>
                              </span>
                              <span className="rounded-full border border-white/[0.09] px-2.5 py-1 text-[10px] capitalize text-[#9ba39f]">
                                {visit.status.replaceAll("_", " ")}
                              </span>
                              <Link
                                aria-label="Open in calendar"
                                className="grid size-8 place-items-center rounded-lg text-[#7e8682] hover:bg-white/[0.05] hover:text-white"
                                href={`/calendar?view=week&date=${visit.starts_at.slice(0, 10)}&opportunity_id=${detail.opportunity_id}`}
                              >
                                <CalendarDays className="size-4" />
                              </Link>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyState
                          action={() => setDialog("visit")}
                          actionLabel="Schedule the first visit"
                          description="Plan a project visit and it will appear here and in Calendar."
                          icon={MapPin}
                          title="No site visits yet"
                        />
                      )}
                    </div>
                  )}

                  {!relatedLoading && drawerTab === "quotes" && (
                    <div>
                      <div className="border-b border-white/[0.08] pb-5">
                        <h3 className="text-base font-semibold text-[#e7ebe8]">
                          Quotations
                        </h3>
                        <p className="mt-1 text-xs text-[#747c78]">
                          Create quotations from priced inventory shortlists.
                        </p>
                      </div>
                      {quotations.length ? (
                        <div className="divide-y divide-white/[0.07]">
                          {quotations.map((quotation) => (
                            <div
                              className="flex items-center gap-4 py-4"
                              key={quotation.quotation_id}
                            >
                              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#172f45] text-[#9dcef9]">
                                <FileText className="size-[18px]" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <strong className="block truncate text-sm text-[#dfe3e0]">
                                  {quotation.quotation_number}
                                </strong>
                                <span className="mt-1 block text-xs text-[#727a76]">
                                  Version {quotation.version} ·{" "}
                                  {quotation.line_items.length} item
                                  {quotation.line_items.length === 1 ? "" : "s"}
                                  {quotation.valid_until
                                    ? ` · Valid until ${formatDate(quotation.valid_until)}`
                                    : ""}
                                </span>
                              </span>
                              <span className="text-right">
                                <strong className="block text-sm text-[#dfe3e0]">
                                  {formatMoney(
                                    quotation.total_amount,
                                    quotation.currency,
                                  )}
                                </strong>
                                <span className="mt-1 block text-[10px] capitalize text-[#727a76]">
                                  {quotation.status}
                                </span>
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyState
                          action={
                            shortlists[0]
                              ? () => setQuoteShortlist(shortlists[0])
                              : undefined
                          }
                          actionLabel={
                            shortlists[0] ? "Create a quotation" : undefined
                          }
                          description={
                            shortlists.length
                              ? "Use a saved selection to prepare the first quotation."
                              : "Save a priced inventory shortlist before preparing a quotation."
                          }
                          icon={FileText}
                          title="No quotations yet"
                        />
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>
        </>
      )}

      {detail && dialog === "edit" && (
        <EditOpportunityDialog
          onClose={() => setDialog(null)}
          onSaved={refreshSelected}
          opportunity={detail}
        />
      )}
      {detail && dialog === "close" && (
        <CloseOpportunityDialog
          onClose={() => setDialog(null)}
          onSaved={refreshSelected}
          opportunity={detail}
        />
      )}
      {detail && dialog === "visit" && (
        <SiteVisitDialog
          onClose={() => setDialog(null)}
          onSaved={async () => {
            await loadRelated(detail);
            await loadOpportunities(true);
          }}
          opportunity={detail}
        />
      )}
      {detail && quoteShortlist && (
        <QuoteDialog
          onClose={() => setQuoteShortlist(null)}
          onSaved={async () => {
            await loadRelated(detail);
          }}
          opportunity={detail}
          shortlist={quoteShortlist}
        />
      )}
    </main>
  );
}
