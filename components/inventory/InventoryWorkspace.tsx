"use client";

import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Boxes,
  Building2,
  Check,
  ChevronRight,
  Clock3,
  FileImage,
  FileSpreadsheet,
  Grid2X2,
  House,
  LoaderCircle,
  LockKeyhole,
  PackageCheck,
  PanelTop,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  UnlockKeyhole,
  Warehouse,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import toast from "react-hot-toast";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";
import { ImportTemplateHint, InventoryDialog } from "./InventoryDialogs";
import { InventoryAttributesManager } from "./InventoryAttributesManager";
import { InventoryPricingWorkspace } from "./InventoryPricingWorkspace";
import type {
  AssetType,
  EffectiveInventoryPrice,
  FloorPlan,
  ImportJob,
  InventoryAttributeDefinition,
  InventoryDialogKind,
  InventoryNode,
  InventoryStatus,
  InventorySummary,
  InventoryUnit,
  InventoryUnitDetail,
  PriceBook,
  ProjectContext,
  UnitType,
} from "./types";

type Tab = "units" | "catalogue" | "structure" | "pricing" | "imports";
type ActionKind =
  | "hold"
  | "reserve"
  | "release"
  | "cancelReservation"
  | "convertReservation"
  | "status";
type EditableInventoryItem =
  InventoryUnit | UnitType | FloorPlan | InventoryNode | PriceBook;

type LeadReference = {
  lead_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

type OpportunityReference = {
  opportunity_id: string;
  opportunity_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

const inventoryStatuses: InventoryStatus[] = [
  "available",
  "held",
  "reserved",
  "booked",
  "sold",
  "blocked",
  "unavailable",
];

const statusStyles: Record<InventoryStatus, string> = {
  available: "border-[#48d6a5]/20 bg-[#48d6a5]/10 text-[#70e1bd]",
  held: "border-[#f7be50]/20 bg-[#f7be50]/10 text-[#f7c967]",
  reserved: "border-[#7fb9ff]/20 bg-[#589ce8]/10 text-[#94c5ff]",
  booked: "border-[#b794ff]/20 bg-[#9b76e8]/10 text-[#c4a9ff]",
  sold: "border-white/[0.12] bg-white/[0.07] text-[#c4c9c6]",
  blocked: "border-[#ff7469]/20 bg-[#ff6257]/10 text-[#ff938b]",
  unavailable: "border-white/[0.1] bg-white/[0.04] text-[#888f8b]",
};

const inputClass =
  "h-10 w-full rounded-lg border border-white/[0.11] bg-[#0a0d0b] px-3 text-sm text-white outline-none transition placeholder:text-[#59605d] focus:border-[#57d6b1]/55 focus:ring-2 focus:ring-[#57d6b1]/10";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetchWithSession(url, { cache: "no-store" });
  if (!response.ok) throw new Error(await getApiError(response));
  return response.json() as Promise<T>;
}

function formatNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatMoney(
  value: number | string | null | undefined,
  currency = "INR",
) {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatAttributeValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (typeof value === "number")
    return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return String(value);
}

function StatusBadge({ status }: { status: InventoryStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusStyles[status]}`}
    >
      <span className="size-1.5 rounded-full bg-current opacity-85" />
      {humanize(status)}
    </span>
  );
}

function SkeletonRows() {
  return (
    <div className="animate-pulse divide-y divide-white/[0.055]">
      {Array.from({ length: 7 }).map((_, index) => (
        <div className="grid grid-cols-6 gap-6 px-5 py-5" key={index}>
          <div className="col-span-2 h-4 rounded bg-white/[0.055]" />
          <div className="h-4 rounded bg-white/[0.04]" />
          <div className="h-4 rounded bg-white/[0.04]" />
          <div className="h-4 rounded bg-white/[0.04]" />
          <div className="h-4 rounded bg-white/[0.04]" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  action,
  description,
  icon: Icon,
  label,
  title,
}: {
  action?: () => void;
  description: string;
  icon: typeof Boxes;
  label?: string;
  title: string;
}) {
  return (
    <div className="grid min-h-[330px] place-items-center px-6 py-14 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-[#8a928e]">
          <Icon className="size-5" />
        </div>
        <h3 className="text-sm font-semibold text-[#e9ebe9]">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-[#737b77]">{description}</p>
        {action && label && (
          <button
            className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-[#26896c] px-3.5 text-xs font-semibold text-white transition hover:bg-[#2e9e7d]"
            onClick={action}
            type="button"
          >
            <Plus className="size-3.5" /> {label}
          </button>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 px-5 py-4 first:pl-0 max-[760px]:px-3 max-[760px]:first:pl-3">
      <p className="truncate text-[11px] font-medium tracking-[0.08em] text-[#6f7773] uppercase">
        {label}
      </p>
      <p className="mt-1.5 text-xl font-semibold tracking-[-0.03em] text-[#edf0ee]">
        {value}
      </p>
    </div>
  );
}

function UnitDrawer({
  attributes,
  detail,
  effectivePrice,
  loading,
  onAction,
  onClose,
  onEdit,
}: {
  attributes: InventoryAttributeDefinition[];
  detail: InventoryUnitDetail | null;
  effectivePrice: EffectiveInventoryPrice | null;
  loading: boolean;
  onAction: (kind: ActionKind, status?: InventoryStatus) => void;
  onClose: () => void;
  onEdit: (unit: InventoryUnitDetail) => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const unit = detail;
  const customDetails = unit
    ? attributes
        .map((attribute) => ({
          ...attribute,
          value:
            attribute.applies_to === "unit"
              ? unit.metadata?.[attribute.attribute_key]
              : unit.type_specifications?.[attribute.attribute_key],
        }))
        .filter((attribute) => attribute.value !== undefined)
    : [];

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px]"
      onMouseDown={onClose}
    >
      <aside
        aria-label="Inventory unit details"
        className="absolute inset-y-0 right-0 flex w-full max-w-[570px] flex-col border-l border-white/[0.13] bg-[#0d110e] shadow-[-30px_0_90px_rgba(0,0,0,.6)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-20 items-center justify-between border-b border-white/[0.09] px-6">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.16em] text-[#69716d] uppercase">
              Inventory unit
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em] text-white">
              {unit?.unit_code ?? "Loading…"}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {unit && (
              <button
                aria-label="Edit inventory unit"
                className="grid size-9 place-items-center rounded-lg text-[#8c9490] transition hover:bg-white/[0.06] hover:text-white"
                onClick={() => onEdit(unit)}
                title="Edit unit"
                type="button"
              >
                <Pencil className="size-4" />
              </button>
            )}
            <button
              aria-label="Close details"
              className="grid size-9 place-items-center rounded-lg text-[#8c9490] transition hover:bg-white/[0.06] hover:text-white"
              onClick={onClose}
              type="button"
            >
              <X className="size-[18px]" />
            </button>
          </div>
        </div>

        {loading || !unit ? (
          <div className="grid flex-1 place-items-center">
            <LoaderCircle className="size-6 animate-spin text-[#55d3ae]" />
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={unit.status} />
                <span className="rounded-full border border-white/[0.1] px-2.5 py-1 text-[11px] font-medium text-[#9ca39f]">
                  {unit.asset_type_name}
                </span>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 border-y border-white/[0.08] py-5">
                {[
                  ["Unit type", unit.type_name],
                  ["Configuration", unit.configuration ?? "—"],
                  ["Location", unit.node_name ?? "Unassigned"],
                  ["Orientation", unit.orientation ?? "—"],
                  [
                    "Area",
                    unit.area_sqft
                      ? `${formatNumber(unit.area_sqft)} sq ft`
                      : unit.saleable_area_sqft
                        ? `${formatNumber(unit.saleable_area_sqft)} sq ft`
                        : "—",
                  ],
                  [
                    "Effective price",
                    formatMoney(
                      effectivePrice?.total_amount ??
                        unit.price_override ??
                        unit.base_price,
                      effectivePrice?.currency ?? unit.currency,
                    ),
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-[10px] tracking-[0.12em] text-[#69716d] uppercase">
                      {label}
                    </p>
                    <p className="mt-1.5 text-sm font-medium text-[#d6dad7]">
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              {customDetails.length > 0 && (
                <section className="mt-7">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[#e4e7e5]">
                      Custom details
                    </h3>
                    <span className="text-xs text-[#69716d]">
                      {customDetails.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-4 border-y border-white/[0.08] py-4">
                    {customDetails.map((attribute) => (
                      <div key={attribute.definition_id}>
                        <p className="text-[10px] tracking-[0.1em] text-[#69716d] uppercase">
                          {attribute.label}
                        </p>
                        <p className="mt-1.5 text-sm text-[#cfd4d1]">
                          {formatAttributeValue(attribute.value)}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {unit.active_hold && (
                <section className="mt-6 rounded-xl border border-[#f4bd52]/20 bg-[#f4bd52]/[0.055] p-4">
                  <div className="flex items-start gap-3">
                    <Clock3 className="mt-0.5 size-4 text-[#f6c968]" />
                    <div>
                      <p className="text-sm font-semibold text-[#efdbac]">
                        Active hold
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#a99b7a]">
                        Expires {formatDate(unit.active_hold.expires_at, true)}
                        {unit.active_hold.reason
                          ? ` · ${unit.active_hold.reason}`
                          : ""}
                      </p>
                    </div>
                  </div>
                </section>
              )}

              {unit.active_reservation && (
                <section className="mt-6 rounded-xl border border-[#73adf2]/20 bg-[#73adf2]/[0.055] p-4">
                  <div className="flex items-start gap-3">
                    <LockKeyhole className="mt-0.5 size-4 text-[#90c2ff]" />
                    <div>
                      <p className="text-sm font-semibold text-[#c7ddf7]">
                        Active reservation
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#829ab7]">
                        {unit.active_reservation.reservation_amount
                          ? `${formatMoney(
                              unit.active_reservation.reservation_amount,
                              unit.active_reservation.currency,
                            )} received`
                          : "No reservation amount recorded"}
                        {unit.active_reservation.expires_at
                          ? ` · Expires ${formatDate(
                              unit.active_reservation.expires_at,
                              true,
                            )}`
                          : ""}
                      </p>
                    </div>
                  </div>
                </section>
              )}

              <section className="mt-7">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#e4e7e5]">
                    Floor plans
                  </h3>
                  <span className="text-xs text-[#69716d]">
                    {unit.floor_plans.length}
                  </span>
                </div>
                {unit.floor_plans.length ? (
                  <div className="divide-y divide-white/[0.07] border-y border-white/[0.08]">
                    {unit.floor_plans.map((plan) => (
                      <div
                        className="flex items-center justify-between gap-4 py-3.5"
                        key={plan.floor_plan_id}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-[#8f9793]">
                            <FileImage className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[#d6dad7]">
                              {plan.plan_name}
                            </p>
                            <p className="mt-0.5 text-xs text-[#6f7773]">
                              {plan.plan_code} · v{plan.version}
                            </p>
                          </div>
                        </div>
                        {plan.assets?.[0]?.asset_url && (
                          <a
                            className="text-xs font-medium text-[#70d8ba] hover:underline"
                            href={plan.assets[0].asset_url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="border-y border-white/[0.08] py-5 text-sm text-[#6e7672]">
                    No floor plan is linked to this unit type.
                  </p>
                )}
              </section>

              {unit.prices.length > 0 && (
                <section className="mt-7">
                  <h3 className="mb-3 text-sm font-semibold text-[#e4e7e5]">
                    Active pricing
                  </h3>
                  <div className="divide-y divide-white/[0.07] border-y border-white/[0.08]">
                    {unit.prices.map((price) => (
                      <div
                        className="flex items-center justify-between py-3.5"
                        key={price.price_entry_id}
                      >
                        <div>
                          <p className="text-sm font-medium text-[#cfd4d1]">
                            {price.price_book_name}
                          </p>
                          <p className="mt-0.5 text-xs text-[#69716d]">
                            {Object.keys(price.components ?? {}).length
                              ? `${Object.keys(price.components).length} adjustments`
                              : "Base price"}
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-white">
                          {formatMoney(
                            Object.values(
                              price.components ?? {},
                            ).reduce<number>(
                              (total, value) =>
                                typeof value === "number" &&
                                Number.isFinite(value)
                                  ? total + value
                                  : total,
                              Number(price.base_amount),
                            ),
                            price.currency,
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <div className="border-t border-white/[0.09] bg-[#0f130f] p-4">
              {unit.status === "available" && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="flex h-11 items-center justify-center gap-2 rounded-lg border border-white/[0.12] text-sm font-semibold text-[#d4d8d6] hover:bg-white/[0.05]"
                    onClick={() => onAction("hold")}
                    type="button"
                  >
                    <Clock3 className="size-4" /> Hold
                  </button>
                  <button
                    className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#277f66] text-sm font-semibold text-white hover:bg-[#2d9274]"
                    onClick={() => onAction("reserve")}
                    type="button"
                  >
                    <LockKeyhole className="size-4" /> Reserve
                  </button>
                  <button
                    className="col-span-2 h-9 text-xs font-medium text-[#7f8783] hover:text-[#ff8d84]"
                    onClick={() => onAction("status", "blocked")}
                    type="button"
                  >
                    Block this unit
                  </button>
                </div>
              )}
              {unit.status === "held" && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="flex h-11 items-center justify-center gap-2 rounded-lg border border-white/[0.12] text-sm font-semibold text-[#d4d8d6] hover:bg-white/[0.05]"
                    onClick={() => onAction("release")}
                    type="button"
                  >
                    <UnlockKeyhole className="size-4" /> Release
                  </button>
                  <button
                    className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#277f66] text-sm font-semibold text-white hover:bg-[#2d9274]"
                    onClick={() => onAction("reserve")}
                    type="button"
                  >
                    <LockKeyhole className="size-4" /> Reserve
                  </button>
                </div>
              )}
              {unit.status === "reserved" && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="h-11 rounded-lg border border-white/[0.12] text-sm font-semibold text-[#d4d8d6] hover:bg-white/[0.05]"
                    onClick={() => onAction("cancelReservation")}
                    type="button"
                  >
                    Cancel reservation
                  </button>
                  <button
                    className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#277f66] text-sm font-semibold text-white hover:bg-[#2d9274]"
                    onClick={() => onAction("convertReservation")}
                    type="button"
                  >
                    <Check className="size-4" /> Mark booked
                  </button>
                </div>
              )}
              {["blocked", "unavailable"].includes(unit.status) && (
                <button
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#277f66] text-sm font-semibold text-white hover:bg-[#2d9274]"
                  onClick={() => onAction("status", "available")}
                  type="button"
                >
                  <UnlockKeyhole className="size-4" /> Make available
                </button>
              )}
              {unit.status === "booked" && (
                <button
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#277f66] text-sm font-semibold text-white hover:bg-[#2d9274]"
                  onClick={() => onAction("status", "sold")}
                  type="button"
                >
                  <PackageCheck className="size-4" /> Mark sold
                </button>
              )}
              {unit.status === "sold" && (
                <p className="py-2 text-center text-xs text-[#747c78]">
                  Sold inventory is locked from further allocation.
                </p>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function UnitActionDialog({
  action,
  leads,
  onClose,
  onDone,
  opportunities,
  targetStatus,
  unit,
}: {
  action: ActionKind;
  leads: LeadReference[];
  onClose: () => void;
  onDone: () => Promise<void>;
  opportunities: OpportunityReference[];
  targetStatus?: InventoryStatus;
  unit: InventoryUnitDetail;
}) {
  const [busy, setBusy] = useState(false);
  const [referenceType, setReferenceType] = useState<"lead" | "opportunity">(
    opportunities.length ? "opportunity" : "lead",
  );
  const [referenceId, setReferenceId] = useState(
    opportunities[0]?.opportunity_id ?? leads[0]?.lead_id ?? "",
  );
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [expiresAt, setExpiresAt] = useState(() => {
    const date = new Date(Date.now() + 48 * 60 * 60 * 1000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  });

  const copy: Record<
    ActionKind,
    { title: string; description: string; button: string }
  > = {
    hold: {
      title: `Hold ${unit.unit_code}`,
      description: "Temporarily remove this unit from general availability.",
      button: "Place hold",
    },
    reserve: {
      title: `Reserve ${unit.unit_code}`,
      description: "Tie this unit to an open opportunity.",
      button: "Reserve unit",
    },
    release: {
      title: "Release hold",
      description: "The unit will become available to the sales team again.",
      button: "Release unit",
    },
    cancelReservation: {
      title: "Cancel reservation",
      description: "The unit will return to available inventory.",
      button: "Cancel reservation",
    },
    convertReservation: {
      title: "Convert to booking",
      description:
        "This confirms the reservation and marks the unit as booked.",
      button: "Confirm booking",
    },
    status: {
      title: `Mark as ${humanize(targetStatus ?? "available")}`,
      description: "This status change is recorded in the unit history.",
      button: "Change status",
    },
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      let url = `/api/inventory/units/${unit.unit_id}`;
      let body: Record<string, unknown> = {};
      if (action === "hold") {
        url += "/hold";
        body = {
          lead_id: referenceType === "lead" ? referenceId : null,
          opportunity_id: referenceType === "opportunity" ? referenceId : null,
          expires_at: new Date(expiresAt).toISOString(),
          reason: reason || null,
        };
      } else if (action === "reserve") {
        url += "/reserve";
        body = {
          opportunity_id: referenceId,
          reservation_amount: amount ? Number(amount) : null,
          currency: unit.currency,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
          notes: reason || null,
        };
      } else if (action === "release") {
        url += "/release";
        body = { reason: reason || null };
      } else if (action === "cancelReservation") {
        url = `/api/inventory/reservations/${unit.active_reservation?.reservation_id}/cancel`;
        body = { reason };
      } else if (action === "convertReservation") {
        url = `/api/inventory/reservations/${unit.active_reservation?.reservation_id}/convert`;
      } else {
        url += "/change-status";
        body = { status: targetStatus, reason };
      }

      const response = await fetchWithSession(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      toast.success(
        copy[action].button.replace(/^./, (letter) => letter.toUpperCase()) +
          " complete",
      );
      await onDone();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to update unit",
      );
    } finally {
      setBusy(false);
    }
  }

  const needsReason = ["cancelReservation", "status"].includes(action);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <form
        className="w-full max-w-[470px] rounded-2xl border border-white/[0.13] bg-[#121613] p-6 shadow-[0_30px_100px_rgba(0,0,0,.75)]"
        onSubmit={submit}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">
              {copy[action].title}
            </h3>
            <p className="mt-1.5 text-sm leading-5 text-[#7e8682]">
              {copy[action].description}
            </p>
          </div>
          <button
            aria-label="Close"
            className="grid size-8 place-items-center rounded-lg text-[#7d8581] hover:bg-white/[0.06] hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        {action === "hold" && (
          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                Hold for
              </label>
              <div className="mb-2 flex gap-2">
                {opportunities.length > 0 && (
                  <button
                    className={`h-8 rounded-lg px-3 text-xs font-medium ${referenceType === "opportunity" ? "bg-white/[0.1] text-white" : "text-[#7d8581]"}`}
                    onClick={() => {
                      setReferenceType("opportunity");
                      setReferenceId(opportunities[0]?.opportunity_id ?? "");
                    }}
                    type="button"
                  >
                    Opportunity
                  </button>
                )}
                {leads.length > 0 && (
                  <button
                    className={`h-8 rounded-lg px-3 text-xs font-medium ${referenceType === "lead" ? "bg-white/[0.1] text-white" : "text-[#7d8581]"}`}
                    onClick={() => {
                      setReferenceType("lead");
                      setReferenceId(leads[0]?.lead_id ?? "");
                    }}
                    type="button"
                  >
                    Lead
                  </button>
                )}
              </div>
              <select
                className={inputClass}
                onChange={(event) => setReferenceId(event.target.value)}
                required
                value={referenceId}
              >
                <option value="">Select {referenceType}</option>
                {(referenceType === "opportunity" ? opportunities : leads).map(
                  (reference) => {
                    const id =
                      "opportunity_id" in reference
                        ? reference.opportunity_id
                        : reference.lead_id;
                    const name =
                      "opportunity_name" in reference
                        ? reference.opportunity_name
                        : [reference.first_name, reference.last_name]
                            .filter(Boolean)
                            .join(" ") || reference.email;
                    return (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    );
                  },
                )}
              </select>
            </div>
          </div>
        )}

        {action === "reserve" && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                Open opportunity
              </span>
              <select
                className={inputClass}
                onChange={(event) => setReferenceId(event.target.value)}
                required
                value={referenceId}
              >
                <option value="">Select opportunity</option>
                {opportunities.map((opportunity) => (
                  <option
                    key={opportunity.opportunity_id}
                    value={opportunity.opportunity_id}
                  >
                    {opportunity.opportunity_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                Reservation amount
              </span>
              <input
                className={inputClass}
                min="0"
                onChange={(event) => setAmount(event.target.value)}
                placeholder="Optional"
                type="number"
                value={amount}
              />
            </label>
            <label>
              <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                Expires at
              </span>
              <input
                className={inputClass}
                min={new Date().toISOString().slice(0, 16)}
                onChange={(event) => setExpiresAt(event.target.value)}
                type="datetime-local"
                value={expiresAt}
              />
            </label>
          </div>
        )}

        {action === "hold" && (
          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
              Hold expires at
            </span>
            <input
              className={inputClass}
              min={new Date().toISOString().slice(0, 16)}
              onChange={(event) => setExpiresAt(event.target.value)}
              required
              type="datetime-local"
              value={expiresAt}
            />
          </label>
        )}

        {!(["convertReservation"] as ActionKind[]).includes(action) && (
          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
              {action === "reserve" ? "Notes" : "Reason"}
            </span>
            <textarea
              className={`${inputClass} min-h-20 resize-y py-3`}
              onChange={(event) => setReason(event.target.value)}
              placeholder={needsReason ? "Required" : "Optional"}
              required={needsReason}
              value={reason}
            />
          </label>
        )}

        {(action === "hold" || action === "reserve") &&
          ((action === "reserve" && !opportunities.length) ||
            (action === "hold" && !opportunities.length && !leads.length)) && (
            <p className="mt-4 rounded-lg border border-[#f3be56]/20 bg-[#f3be56]/[0.06] px-3 py-2 text-xs leading-5 text-[#d5bc86]">
              {action === "reserve"
                ? "This project needs an open opportunity before inventory can be reserved."
                : "This project needs a lead or opportunity before inventory can be held."}
            </p>
          )}

        <div className="mt-6 flex justify-end gap-2 border-t border-white/[0.08] pt-5">
          <button
            className="h-10 rounded-lg border border-white/[0.12] px-4 text-sm font-medium text-[#b7bdb9] hover:bg-white/[0.05]"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="flex h-10 min-w-32 items-center justify-center gap-2 rounded-lg bg-[#277f66] px-4 text-sm font-semibold text-white hover:bg-[#2d9274] disabled:opacity-50"
            disabled={
              busy ||
              (action === "reserve" && !opportunities.length) ||
              (action === "hold" && !opportunities.length && !leads.length)
            }
            type="submit"
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {copy[action].button}
          </button>
        </div>
      </form>
    </div>
  );
}

export function InventoryWorkspace() {
  const [context, setContext] = useState<ProjectContext | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    null,
  );
  const [tab, setTab] = useState<Tab>("units");
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitType[]>([]);
  const [nodes, setNodes] = useState<InventoryNode[]>([]);
  const [floorPlans, setFloorPlans] = useState<FloorPlan[]>([]);
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [priceBooks, setPriceBooks] = useState<PriceBook[]>([]);
  const [attributes, setAttributes] = useState<InventoryAttributeDefinition[]>(
    [],
  );
  const [leads, setLeads] = useState<LeadReference[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityReference[]>(
    [],
  );
  const [pagination, setPagination] = useState({
    page: 1,
    total: 0,
    totalPages: 0,
  });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<InventoryStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<InventoryDialogKind | null>(null);
  const [editingItem, setEditingItem] = useState<EditableInventoryItem | null>(
    null,
  );
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [unitDetail, setUnitDetail] = useState<InventoryUnitDetail | null>(
    null,
  );
  const [effectivePrice, setEffectivePrice] =
    useState<EffectiveInventoryPrice | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [action, setAction] = useState<{
    kind: ActionKind;
    status?: InventoryStatus;
  } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search.trim()),
      280,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    async function loadContext() {
      try {
        const result = await fetchJson<ProjectContext>(
          "/api/auth/project-context",
        );
        if (cancelled) return;
        setContext(result);
        const requestedId = Number(
          new URLSearchParams(window.location.search).get("project_id"),
        );
        const saved = window.localStorage.getItem("sthyra-project-id");
        const savedId = Number(saved);
        const firstProject = result.projects[0]?.project_id ?? null;
        setSelectedProjectId(
          result.projects.some((project) => project.project_id === requestedId)
            ? requestedId
            : result.projects.some((project) => project.project_id === savedId)
              ? savedId
              : firstProject,
        );
      } catch (loadError) {
        if (!cancelled)
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load projects",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadContext();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadUnits = useCallback(async () => {
    if (!selectedProjectId) return;
    setUnitsLoading(true);
    try {
      const params = new URLSearchParams({
        project_id: String(selectedProjectId),
        page: String(page),
        limit: "25",
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (status !== "all") params.set("status", status);
      const data = await fetchJson<{
        units: InventoryUnit[];
        pagination: typeof pagination;
      }>(`/api/inventory/units?${params}`);
      setUnits(data.units);
      setPagination(data.pagination);
    } catch (loadError) {
      toast.error(
        loadError instanceof Error ? loadError.message : "Unable to load units",
      );
    } finally {
      setUnitsLoading(false);
    }
  }, [debouncedSearch, page, selectedProjectId, status]);

  const loadReferenceData = useCallback(async () => {
    if (!selectedProjectId) return;
    const query = `project_id=${selectedProjectId}`;
    try {
      const [
        summaryData,
        typeData,
        nodeData,
        planData,
        assetData,
        importData,
        priceData,
        attributeData,
        leadData,
        opportunityData,
      ] = await Promise.all([
        fetchJson<InventorySummary>(`/api/inventory/summary?${query}`),
        fetchJson<{ unit_types: UnitType[] }>(
          `/api/inventory/unit-types?${query}&include_inactive=true`,
        ),
        fetchJson<{ nodes: InventoryNode[] }>(`/api/inventory/nodes?${query}`),
        fetchJson<{ floor_plans: FloorPlan[] }>(
          `/api/inventory/floor-plans?${query}&include_inactive=true`,
        ),
        fetchJson<{ asset_types: AssetType[] }>("/api/inventory/asset-types"),
        fetchJson<{ imports: ImportJob[] }>(
          `/api/inventory/imports?${query}&limit=50`,
        ),
        fetchJson<{ price_books: PriceBook[] }>(
          `/api/inventory/price-books?${query}`,
        ),
        fetchJson<{ attributes: InventoryAttributeDefinition[] }>(
          `/api/inventory/attributes?${query}`,
        ),
        fetchJson<{ leads: LeadReference[] }>(
          `/api/leads?${query}&limit=100`,
        ).catch(() => ({ leads: [] })),
        fetchJson<{ opportunities: OpportunityReference[] }>(
          `/api/opportunities?${query}&status=open&limit=100`,
        ).catch(() => ({ opportunities: [] })),
      ]);
      setSummary(summaryData);
      setUnitTypes(typeData.unit_types);
      setNodes(nodeData.nodes);
      setFloorPlans(planData.floor_plans);
      setAssetTypes(assetData.asset_types);
      setImports(importData.imports);
      setPriceBooks(priceData.price_books);
      setAttributes(attributeData.attributes);
      setLeads(leadData.leads);
      setOpportunities(opportunityData.opportunities);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load inventory",
      );
    }
  }, [selectedProjectId]);

  const loadUnitDetail = useCallback(async (unitId: string) => {
    setDetailLoading(true);
    try {
      const [result, effective] = await Promise.all([
        fetchJson<{ unit: InventoryUnitDetail }>(
          `/api/inventory/units/${unitId}`,
        ),
        fetchJson<{ price: EffectiveInventoryPrice }>(
          `/api/inventory/prices/effective?unit_id=${unitId}`,
        ).catch(() => ({ price: null })),
      ]);
      setUnitDetail(result.unit);
      setEffectivePrice(effective.price);
    } catch (loadError) {
      toast.error(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load unit details",
      );
      setSelectedUnitId(null);
      setEffectivePrice(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    window.localStorage.setItem("sthyra-project-id", String(selectedProjectId));
    const timer = window.setTimeout(() => void loadReferenceData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReferenceData, selectedProjectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUnits(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUnits]);

  useEffect(() => {
    if (!selectedUnitId) return;
    const timer = window.setTimeout(
      () => void loadUnitDetail(selectedUnitId),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [loadUnitDetail, selectedUnitId]);

  async function refreshAll(showToast = false) {
    setRefreshing(true);
    await Promise.all([loadReferenceData(), loadUnits()]);
    if (selectedUnitId) await loadUnitDetail(selectedUnitId);
    setRefreshing(false);
    if (showToast) toast.success("Inventory refreshed");
  }

  const statusCounts = useMemo(
    () =>
      Object.fromEntries(
        (summary?.status_counts ?? []).map((item) => [item.status, item.count]),
      ) as Partial<Record<InventoryStatus, number>>,
    [summary],
  );

  const activeProject = context?.projects.find(
    (project) => project.project_id === selectedProjectId,
  );

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: "units", label: "Units", count: summary?.unit_count },
    { key: "catalogue", label: "Catalogue", count: summary?.unit_type_count },
    { key: "structure", label: "Structure", count: summary?.node_count },
    { key: "pricing", label: "Pricing", count: priceBooks.length },
    { key: "imports", label: "Imports", count: imports.length },
  ];

  const primaryAction: Record<
    Tab,
    { label: string; kind: InventoryDialogKind }
  > = {
    units: { label: "Add unit", kind: "unit" },
    catalogue: { label: "Create unit type", kind: "unitType" },
    structure: { label: "Add structure", kind: "node" },
    pricing: { label: "Create price book", kind: "priceBook" },
    imports: { label: "Import CSV", kind: "import" },
  };

  function openDialog(
    kind: InventoryDialogKind,
    item: EditableInventoryItem | null = null,
  ) {
    setEditingItem(item);
    setDialog(kind);
  }

  function closeDialog() {
    setDialog(null);
    setEditingItem(null);
  }

  if (loading) {
    return (
      <main className="min-h-dvh bg-[#070908] text-white">
        <DashboardSidebar />
        <div className="ml-[96px] grid min-h-dvh place-items-center max-[560px]:ml-[88px]">
          <LoaderCircle className="size-6 animate-spin text-[#55d3ae]" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#070908] text-white">
      <DashboardSidebar />
      <div className="ml-[96px] min-h-dvh max-[560px]:ml-[88px]">
        <header className="border-b border-white/[0.08] px-7 py-6 max-[700px]:px-4">
          <div className="mx-auto flex max-w-[1680px] flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.17em] text-[#69716d] uppercase">
                Sales operations
              </p>
              <h1 className="mt-1.5 text-[28px] font-semibold tracking-[-0.04em] text-[#f4f6f5]">
                Inventory
              </h1>
              <p className="mt-1 text-sm text-[#7d8581]">
                Availability, configurations and pricing in one workspace.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Project"
                className="h-10 min-w-48 rounded-lg border border-white/[0.11] bg-[#0e120f] px-3 text-sm text-[#d4d8d6] outline-none focus:border-[#57d6b1]/45"
                onChange={(event) => {
                  setPage(1);
                  setUnitDetail(null);
                  setSelectedUnitId(null);
                  setSelectedProjectId(Number(event.target.value));
                }}
                value={selectedProjectId ?? ""}
              >
                {context?.projects.map((project) => (
                  <option key={project.project_id} value={project.project_id}>
                    {project.project_name}
                  </option>
                ))}
              </select>
              <button
                aria-label="Refresh inventory"
                className="grid size-10 place-items-center rounded-lg border border-white/[0.11] bg-[#0e120f] text-[#9da49f] transition hover:bg-white/[0.05] hover:text-white"
                onClick={() => refreshAll(true)}
                type="button"
              >
                <RefreshCw
                  className={`size-4 ${refreshing ? "animate-spin" : ""}`}
                />
              </button>
              {tab === "units" && (
                <button
                  className="flex h-10 items-center gap-2 rounded-lg border border-white/[0.11] bg-[#0e120f] px-3 text-sm font-medium text-[#bcc2bf] transition hover:bg-white/[0.05] hover:text-white max-[640px]:hidden"
                  onClick={() => openDialog("generate")}
                  type="button"
                >
                  <Sparkles className="size-4" /> Generate
                </button>
              )}
              <button
                className="flex h-10 items-center gap-2 rounded-lg bg-[#27886c] px-4 text-sm font-semibold text-white transition hover:bg-[#2d9b7b]"
                onClick={() => openDialog(primaryAction[tab].kind)}
                type="button"
              >
                <Plus className="size-4" /> {primaryAction[tab].label}
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1680px] px-7 pb-8 max-[700px]:px-4">
          {!selectedProjectId ? (
            <EmptyState
              description="Create or join a project before setting up inventory."
              icon={Building2}
              title="No project available"
            />
          ) : (
            <>
              <section className="grid grid-cols-6 divide-x divide-white/[0.07] border-b border-white/[0.08] max-[980px]:grid-cols-3 max-[980px]:divide-x-0 max-[560px]:grid-cols-2">
                <Metric
                  label="Total units"
                  value={summary?.unit_count ?? "—"}
                />
                <Metric label="Available" value={statusCounts.available ?? 0} />
                <Metric label="On hold" value={statusCounts.held ?? 0} />
                <Metric label="Reserved" value={statusCounts.reserved ?? 0} />
                <Metric label="Booked" value={statusCounts.booked ?? 0} />
                <Metric label="Sold" value={statusCounts.sold ?? 0} />
              </section>

              <nav className="flex items-center gap-6 overflow-x-auto border-b border-white/[0.08] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {tabs.map((item) => (
                  <button
                    className={`relative flex h-[58px] shrink-0 items-center gap-2 text-sm font-medium transition ${
                      tab === item.key
                        ? "text-white"
                        : "text-[#777f7b] hover:text-[#c8cdca]"
                    }`}
                    key={item.key}
                    onClick={() => setTab(item.key)}
                    type="button"
                  >
                    {item.label}
                    {item.count !== undefined && (
                      <span className="text-[11px] text-[#5f6763]">
                        {item.count}
                      </span>
                    )}
                    {tab === item.key && (
                      <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[#50d3ac]" />
                    )}
                  </button>
                ))}
              </nav>

              {error && (
                <div className="mt-5 flex items-center justify-between rounded-xl border border-[#ff6b61]/20 bg-[#ff6b61]/[0.055] px-4 py-3">
                  <p className="text-sm text-[#ff9a92]">{error}</p>
                  <button
                    className="text-xs font-semibold text-[#ffaca6] hover:text-white"
                    onClick={() => refreshAll()}
                    type="button"
                  >
                    Retry
                  </button>
                </div>
              )}

              {tab === "units" && (
                <section className="pt-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <label className="relative min-w-[240px] flex-1 sm:max-w-sm">
                        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#626a66]" />
                        <input
                          className={`${inputClass} pl-9`}
                          onChange={(event) => {
                            setSearch(event.target.value);
                            setPage(1);
                          }}
                          placeholder="Search unit code, name or type"
                          value={search}
                        />
                      </label>
                      <label className="relative">
                        <SlidersHorizontal className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[#626a66]" />
                        <select
                          className={`${inputClass} w-auto min-w-36 pl-9 pr-8 capitalize`}
                          onChange={(event) => {
                            setStatus(
                              event.target.value as InventoryStatus | "all",
                            );
                            setPage(1);
                          }}
                          value={status}
                        >
                          <option value="all">All statuses</option>
                          {inventoryStatuses.map((item) => (
                            <option key={item} value={item}>
                              {humanize(item)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="text-xs text-[#68706c]">
                      {pagination.total.toLocaleString()} units ·{" "}
                      {activeProject?.project_code}
                    </p>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-white/[0.09] bg-[#0b0e0c]">
                    {unitsLoading ? (
                      <SkeletonRows />
                    ) : units.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[1040px] text-left">
                          <thead className="border-b border-white/[0.08] bg-white/[0.018]">
                            <tr className="text-[10px] font-semibold tracking-[0.08em] text-[#69716d] uppercase">
                              <th className="px-5 py-3.5">Unit</th>
                              <th className="px-5 py-3.5">Type</th>
                              <th className="px-5 py-3.5">Location</th>
                              <th className="px-5 py-3.5">Area</th>
                              <th className="px-5 py-3.5">Price</th>
                              <th className="px-5 py-3.5">Status</th>
                              <th className="w-12 px-4 py-3.5" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/[0.06]">
                            {units.map((unit) => (
                              <tr
                                className="cursor-pointer transition hover:bg-white/[0.025]"
                                key={unit.unit_id}
                                onClick={() => {
                                  setUnitDetail(null);
                                  setSelectedUnitId(unit.unit_id);
                                }}
                              >
                                <td className="px-5 py-4">
                                  <div className="flex items-center gap-3">
                                    <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.035] text-[#7f8883]">
                                      {unit.asset_type_key === "villa" ? (
                                        <House className="size-4" />
                                      ) : (
                                        <Warehouse className="size-4" />
                                      )}
                                    </span>
                                    <div>
                                      <p className="text-sm font-semibold text-[#e5e8e6]">
                                        {unit.unit_code}
                                      </p>
                                      <p className="mt-0.5 text-xs text-[#656d69]">
                                        {unit.unit_name ?? unit.asset_type_name}
                                      </p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-5 py-4">
                                  <p className="text-sm text-[#c3c8c5]">
                                    {unit.type_name}
                                  </p>
                                  <p className="mt-0.5 text-xs text-[#656d69]">
                                    {unit.configuration ?? unit.type_code}
                                  </p>
                                </td>
                                <td className="px-5 py-4 text-sm text-[#9ba29e]">
                                  {unit.node_name ?? "Unassigned"}
                                </td>
                                <td className="px-5 py-4 text-sm text-[#9ba29e]">
                                  {(unit.area_sqft ?? unit.saleable_area_sqft)
                                    ? `${formatNumber(unit.area_sqft ?? unit.saleable_area_sqft)} sq ft`
                                    : "—"}
                                </td>
                                <td className="px-5 py-4 text-sm font-medium text-[#cbd0cd]">
                                  {formatMoney(
                                    unit.effective_price ??
                                      unit.price_override ??
                                      unit.base_price,
                                    unit.effective_price_currency ??
                                      unit.currency,
                                  )}
                                </td>
                                <td className="px-5 py-4">
                                  <StatusBadge status={unit.status} />
                                </td>
                                <td className="px-4 py-4 text-[#59615d]">
                                  <ChevronRight className="size-4" />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <EmptyState
                        action={
                          search || status !== "all"
                            ? () => {
                                setSearch("");
                                setStatus("all");
                              }
                            : () => openDialog("generate")
                        }
                        description={
                          search || status !== "all"
                            ? "Try clearing the search or status filter."
                            : "Generate a tower, import a spreadsheet, or add your first unit manually."
                        }
                        icon={Boxes}
                        label={
                          search || status !== "all"
                            ? "Clear filters"
                            : "Generate units"
                        }
                        title={
                          search || status !== "all"
                            ? "No matching units"
                            : "No inventory units yet"
                        }
                      />
                    )}

                    {pagination.totalPages > 1 && (
                      <div className="flex items-center justify-between border-t border-white/[0.08] px-5 py-3">
                        <p className="text-xs text-[#69716d]">
                          Page {pagination.page} of {pagination.totalPages}
                        </p>
                        <div className="flex gap-2">
                          <button
                            aria-label="Previous page"
                            className="grid size-8 place-items-center rounded-lg border border-white/[0.1] text-[#929995] hover:bg-white/[0.05] disabled:opacity-35"
                            disabled={page <= 1}
                            onClick={() => setPage((current) => current - 1)}
                            type="button"
                          >
                            <ArrowLeft className="size-3.5" />
                          </button>
                          <button
                            aria-label="Next page"
                            className="grid size-8 place-items-center rounded-lg border border-white/[0.1] text-[#929995] hover:bg-white/[0.05] disabled:opacity-35"
                            disabled={page >= pagination.totalPages}
                            onClick={() => setPage((current) => current + 1)}
                            type="button"
                          >
                            <ArrowRight className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {tab === "catalogue" && (
                <section className="grid gap-10 pt-7 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,.75fr)]">
                  <div>
                    <div className="mb-4 flex items-end justify-between gap-4">
                      <div>
                        <h2 className="text-base font-semibold text-[#e8ebe9]">
                          Unit types
                        </h2>
                        <p className="mt-1 text-sm text-[#747c78]">
                          Reusable product definitions shared by individual
                          units.
                        </p>
                      </div>
                      <button
                        className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.11] px-3 text-xs font-semibold text-[#c3c8c5] hover:bg-white/[0.05]"
                        onClick={() => openDialog("unitType")}
                        type="button"
                      >
                        <Plus className="size-3.5" /> Add type
                      </button>
                    </div>
                    {unitTypes.length ? (
                      <div className="divide-y divide-white/[0.07] border-y border-white/[0.08]">
                        {unitTypes.map((type) => (
                          <div
                            className="grid grid-cols-[minmax(0,1.3fr)_minmax(100px,.65fr)_minmax(120px,.65fr)_90px] items-center gap-5 py-4 max-[760px]:grid-cols-[minmax(0,1fr)_90px]"
                            key={type.unit_type_id}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.045] text-[#8a928e]">
                                <Grid2X2 className="size-4" />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-[#e2e5e3]">
                                  {type.type_name}
                                </p>
                                <p className="mt-0.5 truncate text-xs text-[#69716d]">
                                  {type.type_code} · {type.asset_type_name}
                                  {!type.is_active && " · Inactive"}
                                </p>
                              </div>
                            </div>
                            <div className="max-[760px]:hidden">
                              <p className="text-[10px] tracking-[0.08em] text-[#606864] uppercase">
                                Configuration
                              </p>
                              <p className="mt-1 text-sm text-[#aab1ad]">
                                {type.configuration ?? "—"}
                              </p>
                            </div>
                            <div className="max-[760px]:hidden">
                              <p className="text-[10px] tracking-[0.08em] text-[#606864] uppercase">
                                Base price
                              </p>
                              <p className="mt-1 text-sm text-[#aab1ad]">
                                {formatMoney(type.base_price, type.currency)}
                              </p>
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-xs text-[#59615d]">
                                {type.floor_plans.length} plan
                                {type.floor_plans.length === 1 ? "" : "s"}
                              </span>
                              <button
                                aria-label={`Edit ${type.type_name}`}
                                className="grid size-8 place-items-center rounded-lg text-[#77807b] transition hover:bg-white/[0.06] hover:text-white"
                                onClick={() => openDialog("unitType", type)}
                                title="Edit unit type"
                                type="button"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        action={() => openDialog("unitType")}
                        description="Define configurations such as 2 BHK, villa types, commercial suites, or any custom asset."
                        icon={Grid2X2}
                        label="Create unit type"
                        title="Build your inventory catalogue"
                      />
                    )}
                  </div>

                  <div>
                    <div className="mb-4 flex items-end justify-between gap-4">
                      <div>
                        <h2 className="text-base font-semibold text-[#e8ebe9]">
                          Floor plans
                        </h2>
                        <p className="mt-1 text-sm text-[#747c78]">
                          Versioned once, reused everywhere.
                        </p>
                      </div>
                      <button
                        className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.11] px-3 text-xs font-semibold text-[#c3c8c5] hover:bg-white/[0.05]"
                        onClick={() => openDialog("floorPlan")}
                        type="button"
                      >
                        <Plus className="size-3.5" /> Add plan
                      </button>
                    </div>
                    {floorPlans.length ? (
                      <div className="divide-y divide-white/[0.07] border-y border-white/[0.08]">
                        {floorPlans.map((plan) => (
                          <div
                            className="flex items-center gap-3 py-4"
                            key={plan.floor_plan_id}
                          >
                            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.035] text-[#8d9591]">
                              <FileImage className="size-[18px]" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-[#dfe3e0]">
                                {plan.plan_name}
                              </p>
                              <p className="mt-0.5 text-xs text-[#69716d]">
                                {plan.plan_code} · Version {plan.version}
                                {!plan.is_active && " · Inactive"}
                              </p>
                            </div>
                            <span className="text-xs text-[#67706b]">
                              {plan.assets.length} file
                              {plan.assets.length === 1 ? "" : "s"}
                            </span>
                            <button
                              aria-label={`Edit ${plan.plan_name}`}
                              className="grid size-8 shrink-0 place-items-center rounded-lg text-[#77807b] transition hover:bg-white/[0.06] hover:text-white"
                              onClick={() => openDialog("floorPlan", plan)}
                              title="Edit floor plan"
                              type="button"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="border-y border-white/[0.08] py-10 text-center">
                        <p className="text-sm text-[#747c78]">
                          No floor plans yet.
                        </p>
                        <button
                          className="mt-3 text-xs font-semibold text-[#69d7b6] hover:underline"
                          onClick={() => openDialog("floorPlan")}
                          type="button"
                        >
                          Add the first plan
                        </button>
                      </div>
                    )}
                  </div>
                  <InventoryAttributesManager
                    attributes={attributes}
                    onChanged={loadReferenceData}
                    projectId={selectedProjectId}
                  />
                </section>
              )}

              {tab === "structure" && (
                <section className="pt-7">
                  <div className="mb-5 flex items-end justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-[#e8ebe9]">
                        Project structure
                      </h2>
                      <p className="mt-1 text-sm text-[#747c78]">
                        A flexible hierarchy for phases, towers, floors, villas
                        and custom locations.
                      </p>
                    </div>
                    <button
                      className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.11] px-3 text-xs font-semibold text-[#c3c8c5] hover:bg-white/[0.05]"
                      onClick={() => openDialog("node")}
                      type="button"
                    >
                      <Plus className="size-3.5" /> Add item
                    </button>
                  </div>
                  {nodes.length ? (
                    <div className="overflow-hidden rounded-xl border border-white/[0.09] bg-[#0b0e0c]">
                      <div className="grid grid-cols-[minmax(0,1fr)_180px_140px] border-b border-white/[0.08] px-5 py-3 text-[10px] font-semibold tracking-[0.08em] text-[#69716d] uppercase max-[680px]:grid-cols-[minmax(0,1fr)_100px]">
                        <span>Location</span>
                        <span className="max-[680px]:hidden">Code</span>
                        <span>Kind</span>
                      </div>
                      <div className="divide-y divide-white/[0.06]">
                        {nodes.map((node) => (
                          <div
                            className="grid grid-cols-[minmax(0,1fr)_180px_140px] items-center px-5 py-3.5 max-[680px]:grid-cols-[minmax(0,1fr)_100px]"
                            key={node.node_id}
                          >
                            <div
                              className="flex min-w-0 items-center gap-3"
                              style={{
                                paddingLeft: `${Math.min(node.depth, 6) * 24}px`,
                              }}
                            >
                              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.04] text-[#7e8682]">
                                {node.node_kind === "floor" ? (
                                  <PanelTop className="size-4" />
                                ) : (
                                  <Building2 className="size-4" />
                                )}
                              </span>
                              <p className="truncate text-sm font-medium text-[#d6dad7]">
                                {node.node_name}
                              </p>
                            </div>
                            <p className="text-xs text-[#737b77] max-[680px]:hidden">
                              {node.node_code}
                            </p>
                            <div className="flex items-center justify-between gap-2">
                              <span className="w-fit rounded-md bg-white/[0.045] px-2 py-1 text-[10px] font-medium text-[#8d9591]">
                                {humanize(node.node_kind)}
                              </span>
                              <button
                                aria-label={`Edit ${node.node_name}`}
                                className="grid size-8 shrink-0 place-items-center rounded-lg text-[#77807b] transition hover:bg-white/[0.06] hover:text-white"
                                onClick={() => openDialog("node", node)}
                                title="Edit structure item"
                                type="button"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <EmptyState
                      action={() => openDialog("node")}
                      description="Start with a phase, tower, building, cluster or any location hierarchy that matches this project."
                      icon={Building2}
                      label="Add structure"
                      title="No structure configured"
                    />
                  )}
                </section>
              )}

              {tab === "pricing" && (
                <InventoryPricingWorkspace
                  onChanged={() => refreshAll()}
                  onCreateBook={() => openDialog("priceBook")}
                  onEditBook={(book) => openDialog("priceBook", book)}
                  priceBooks={priceBooks}
                  projectId={selectedProjectId}
                  unitTypes={unitTypes}
                />
              )}

              {tab === "imports" && (
                <section className="grid gap-8 pt-7 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.55fr)]">
                  <div>
                    <div className="mb-5 flex items-end justify-between gap-4">
                      <div>
                        <h2 className="text-base font-semibold text-[#e8ebe9]">
                          Import history
                        </h2>
                        <p className="mt-1 text-sm text-[#747c78]">
                          Audit every spreadsheet import and generated batch.
                        </p>
                      </div>
                      <button
                        className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.11] px-3 text-xs font-semibold text-[#c3c8c5] hover:bg-white/[0.05]"
                        onClick={() => openDialog("import")}
                        type="button"
                      >
                        <ArrowDownToLine className="size-3.5" /> Import CSV
                      </button>
                    </div>
                    {imports.length ? (
                      <div className="divide-y divide-white/[0.07] border-y border-white/[0.08]">
                        {imports.map((job) => {
                          const total = Number(job.total_rows || 0);
                          const succeeded = Number(job.succeeded_rows || 0);
                          const failed = Number(job.failed_rows || 0);
                          const progress = total
                            ? Math.round(((succeeded + failed) / total) * 100)
                            : 0;
                          return (
                            <div className="py-4" key={job.import_id}>
                              <div className="flex items-center gap-3">
                                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.045] text-[#89918d]">
                                  {job.source === "generator" ? (
                                    <Sparkles className="size-4" />
                                  ) : (
                                    <FileSpreadsheet className="size-4" />
                                  )}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className="truncate text-sm font-semibold text-[#dce0dd]">
                                      {job.file_name ??
                                        (job.source === "generator"
                                          ? "Generated inventory"
                                          : "API import")}
                                    </p>
                                    <span
                                      className={`text-[10px] font-semibold uppercase ${job.status === "completed" ? "text-[#64d9b6]" : job.status === "failed" ? "text-[#ff8d84]" : "text-[#e4bd64]"}`}
                                    >
                                      {job.status}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-xs text-[#68706c]">
                                    {formatDate(job.created_at, true)} ·{" "}
                                    {total.toLocaleString()} rows
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs font-medium text-[#9ca39f]">
                                    {succeeded.toLocaleString()} imported
                                  </p>
                                  {failed > 0 && (
                                    <p className="mt-0.5 text-[10px] text-[#ff8d84]">
                                      {failed} failed
                                    </p>
                                  )}
                                </div>
                              </div>
                              {job.status === "processing" && (
                                <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                                  <div
                                    className="h-full rounded-full bg-[#55d3ae]"
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <EmptyState
                        action={() => openDialog("import")}
                        description="Upload an existing unit register or generate a project structure from scratch."
                        icon={FileSpreadsheet}
                        label="Import CSV"
                        title="No inventory batches yet"
                      />
                    )}
                  </div>
                  <div className="space-y-3">
                    <ImportTemplateHint />
                    <button
                      className="flex w-full items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 text-left transition hover:bg-white/[0.04]"
                      onClick={() => openDialog("generate")}
                      type="button"
                    >
                      <Sparkles className="mt-0.5 size-5 shrink-0 text-[#75dcbc]" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-[#d9dddb]">
                          Generate at scale
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-[#79817d]">
                          Create villas as a numbered series or build a complete
                          tower floor by floor.
                        </span>
                      </span>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-[#59605d]" />
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {dialog && selectedProjectId && (
        <InventoryDialog
          assetTypes={assetTypes}
          attributes={attributes}
          floorPlans={floorPlans}
          editing={editingItem}
          kind={dialog}
          nodes={nodes}
          onClose={closeDialog}
          onSaved={() => refreshAll()}
          projectId={selectedProjectId}
          unitTypes={unitTypes}
        />
      )}

      {selectedUnitId && (
        <UnitDrawer
          attributes={attributes}
          detail={unitDetail}
          loading={detailLoading}
          onAction={(kind, targetStatus) =>
            setAction({ kind, status: targetStatus })
          }
          onClose={() => {
            setSelectedUnitId(null);
            setUnitDetail(null);
            setEffectivePrice(null);
          }}
          effectivePrice={effectivePrice}
          onEdit={(unit) => openDialog("unit", unit)}
        />
      )}

      {action && unitDetail && (
        <UnitActionDialog
          action={action.kind}
          leads={leads}
          onClose={() => setAction(null)}
          onDone={async () => {
            await refreshAll();
          }}
          opportunities={opportunities}
          targetStatus={action.status}
          unit={unitDetail}
        />
      )}
    </main>
  );
}
