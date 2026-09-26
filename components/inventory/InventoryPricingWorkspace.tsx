"use client";

import {
  BadgeIndianRupee,
  Check,
  CircleDollarSign,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
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
import { fetchWithSession, getApiError } from "@/lib/clientAuth";
import type { InventoryUnit, PriceBook, PriceEntry, UnitType } from "./types";

const inputClass =
  "h-11 w-full rounded-lg border border-white/[0.11] bg-[#0b0e0c] px-3 text-sm text-white outline-none transition placeholder:text-[#59605d] focus:border-[#57d6b1]/55 focus:ring-2 focus:ring-[#57d6b1]/10 disabled:cursor-not-allowed disabled:opacity-50";

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithSession(url, {
    cache: "no-store",
    ...init,
  });
  if (!response.ok) throw new Error(await getApiError(response));
  return response.json() as Promise<T>;
}

function money(value: number | string, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function shortDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function entryTotal(entry: PriceEntry) {
  return Object.values(entry.components ?? {}).reduce<number>(
    (total, value) =>
      typeof value === "number" && Number.isFinite(value)
        ? total + value
        : total,
    Number(entry.base_amount),
  );
}

function priceTiming(entry: PriceEntry, book: PriceBook) {
  if (!book.is_active)
    return { label: "Inactive", className: "bg-white/[0.05] text-[#7b837f]" };
  const today = new Date().toISOString().slice(0, 10);
  const starts = [book.valid_from, entry.valid_from]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.slice(0, 10));
  const ends = [book.valid_until, entry.valid_until]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.slice(0, 10));
  const startsAt = starts.sort().at(-1);
  const endsAt = ends.sort()[0];
  if (startsAt && startsAt > today)
    return {
      label: "Upcoming",
      className: "bg-[#e6b95b]/10 text-[#d9b663]",
    };
  if (endsAt && endsAt < today)
    return { label: "Expired", className: "bg-white/[0.05] text-[#777f7b]" };
  return {
    label: "Effective now",
    className: "bg-[#57d6b1]/[0.08] text-[#68cfb0]",
  };
}

type ComponentRow = { key: string; amount: string };

function PriceEntryDialog({
  book,
  editing,
  onClose,
  onSaved,
  projectId,
  unitTypes,
}: {
  book: PriceBook;
  editing: PriceEntry | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  projectId: number;
  unitTypes: UnitType[];
}) {
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<"unit_type" | "unit">(
    editing?.unit_id ? "unit" : "unit_type",
  );
  const [targetId, setTargetId] = useState(
    editing?.unit_id ??
      editing?.unit_type_id ??
      unitTypes[0]?.unit_type_id ??
      "",
  );
  const [amount, setAmount] = useState(String(editing?.base_amount ?? ""));
  const [validFrom, setValidFrom] = useState(
    editing?.valid_from?.slice(0, 10) ?? "",
  );
  const [validUntil, setValidUntil] = useState(
    editing?.valid_until?.slice(0, 10) ?? "",
  );
  const [components, setComponents] = useState<ComponentRow[]>(() =>
    Object.entries(editing?.components ?? {}).map(([key, value]) => ({
      key,
      amount: typeof value === "number" ? String(value) : "",
    })),
  );
  const [unitSearch, setUnitSearch] = useState("");
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);

  useEffect(() => {
    if (target !== "unit") return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setUnitsLoading(true);
      try {
        const params = new URLSearchParams({
          project_id: String(projectId),
          limit: "50",
        });
        if (unitSearch.trim()) params.set("search", unitSearch.trim());
        const result = await apiJson<{ units: InventoryUnit[] }>(
          `/api/inventory/units?${params}`,
        );
        if (!cancelled) setUnits(result.units);
      } catch (error) {
        if (!cancelled)
          toast.error(
            error instanceof Error ? error.message : "Unable to search units",
          );
      } finally {
        if (!cancelled) setUnitsLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectId, target, unitSearch]);

  const total = useMemo(
    () =>
      components.reduce(
        (sum, component) => sum + Number(component.amount || 0),
        Number(amount || 0),
      ),
    [amount, components],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!targetId) {
      toast.error(`Select a ${target === "unit" ? "unit" : "unit type"}`);
      return;
    }
    const componentObject = Object.fromEntries(
      components
        .filter((component) => component.key.trim() && component.amount !== "")
        .map((component) => [
          component.key
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_"),
          Number(component.amount),
        ]),
    );
    setBusy(true);
    try {
      const body = {
        base_amount: Number(amount),
        components: componentObject,
        valid_from: validFrom || null,
        valid_until: validUntil || null,
        ...(editing
          ? {}
          : {
              price_book_id: book.price_book_id,
              unit_type_id: target === "unit_type" ? targetId : null,
              unit_id: target === "unit" ? targetId : null,
            }),
      };
      await apiJson(
        editing
          ? `/api/inventory/prices/${editing.price_entry_id}`
          : "/api/inventory/prices",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      toast.success(editing ? "Price updated" : "Price added");
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save price",
      );
    } finally {
      setBusy(false);
    }
  }

  const editingTarget = editing?.unit_id
    ? `${editing.unit_code ?? "Unit"}${editing.unit_name ? ` · ${editing.unit_name}` : ""}`
    : editing?.type_name
      ? `${editing.type_name} · ${editing.type_code}`
      : "";

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="dialog"
    >
      <div className="max-h-[calc(100dvh-32px)] w-full max-w-[640px] overflow-y-auto rounded-2xl border border-white/[0.13] bg-[#111512] shadow-[0_30px_100px_rgba(0,0,0,.7)]">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-white/[0.09] bg-[#111512]/95 px-6 py-5 backdrop-blur-xl">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {editing ? "Edit price" : "Add price"}
            </h2>
            <p className="mt-1 text-sm text-[#7f8783]">
              {book.price_book_name} · {book.currency}
            </p>
          </div>
          <button
            aria-label="Close"
            className="grid size-9 place-items-center rounded-lg text-[#909793] hover:bg-white/[0.07] hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X className="size-[18px]" />
          </button>
        </div>

        <form className="p-6" onSubmit={submit}>
          {editing ? (
            <div className="mb-5 border-b border-white/[0.08] pb-5">
              <p className="text-xs font-medium text-[#737b77] uppercase">
                Price target
              </p>
              <p className="mt-1.5 text-sm font-medium text-[#e2e5e3]">
                {editingTarget}
              </p>
              {editing.source === "unit_type_base" && (
                <p className="mt-2 text-xs leading-5 text-[#d0b578]">
                  Editing this synchronized base price converts it into a manual
                  price so later unit-type changes will not overwrite it.
                </p>
              )}
            </div>
          ) : (
            <div className="mb-5">
              <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                Apply price to
              </span>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-black/25 p-1">
                {(["unit_type", "unit"] as const).map((value) => (
                  <button
                    className={`h-10 rounded-md text-sm font-medium transition ${target === value ? "bg-white/[0.1] text-white" : "text-[#7f8783] hover:text-white"}`}
                    key={value}
                    onClick={() => {
                      setTarget(value);
                      setTargetId(
                        value === "unit_type"
                          ? (unitTypes[0]?.unit_type_id ?? "")
                          : "",
                      );
                    }}
                    type="button"
                  >
                    {value === "unit_type" ? "Unit type" : "Individual unit"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!editing && target === "unit_type" && (
            <label className="mb-5 block">
              <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                Unit type
              </span>
              <select
                className={inputClass}
                onChange={(event) => setTargetId(event.target.value)}
                required
                value={targetId}
              >
                <option value="">Select unit type</option>
                {unitTypes.map((type) => (
                  <option key={type.unit_type_id} value={type.unit_type_id}>
                    {type.type_name} · {type.type_code}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!editing && target === "unit" && (
            <div className="mb-5 grid gap-3">
              <label>
                <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                  Find unit
                </span>
                <div className="relative">
                  <Search className="absolute top-3.5 left-3 size-4 text-[#66706b]" />
                  <input
                    className={`${inputClass} pl-9`}
                    onChange={(event) => setUnitSearch(event.target.value)}
                    placeholder="Search by unit code or name"
                    value={unitSearch}
                  />
                  {unitsLoading && (
                    <LoaderCircle className="absolute top-3.5 right-3 size-4 animate-spin text-[#66706b]" />
                  )}
                </div>
              </label>
              <select
                aria-label="Unit"
                className={inputClass}
                onChange={(event) => setTargetId(event.target.value)}
                required
                value={targetId}
              >
                <option value="">Select unit</option>
                {units.map((unit) => (
                  <option key={unit.unit_id} value={unit.unit_id}>
                    {unit.unit_code} · {unit.type_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                Base amount
              </span>
              <div className="relative">
                <span className="absolute top-3 left-3 text-sm text-[#747c78]">
                  {book.currency}
                </span>
                <input
                  autoFocus={Boolean(editing)}
                  className={`${inputClass} pl-14`}
                  min="0"
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0"
                  required
                  step="0.01"
                  type="number"
                  value={amount}
                />
              </div>
            </label>
            <label>
              <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                Valid from
              </span>
              <input
                className={inputClass}
                onChange={(event) => setValidFrom(event.target.value)}
                type="date"
                value={validFrom}
              />
            </label>
            <label>
              <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                Valid until
              </span>
              <input
                className={inputClass}
                min={validFrom || undefined}
                onChange={(event) => setValidUntil(event.target.value)}
                type="date"
                value={validUntil}
              />
            </label>
          </div>

          <div className="mt-6 border-t border-white/[0.08] pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[#dfe3e0]">
                  Price components
                </p>
                <p className="mt-0.5 text-xs text-[#6f7773]">
                  Floor rise, parking, PLC, discounts, or other adjustments.
                </p>
              </div>
              <button
                className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.1] px-2.5 text-xs text-[#b9bfbc] hover:bg-white/[0.05]"
                onClick={() =>
                  setComponents((current) => [
                    ...current,
                    { key: "", amount: "" },
                  ])
                }
                type="button"
              >
                <Plus className="size-3.5" /> Add component
              </button>
            </div>
            {components.length > 0 && (
              <div className="mt-4 space-y-2">
                {components.map((component, index) => (
                  <div
                    className="grid grid-cols-[minmax(0,1fr)_minmax(130px,.55fr)_36px] gap-2"
                    key={index}
                  >
                    <input
                      aria-label={`Component ${index + 1} name`}
                      className={inputClass}
                      onChange={(event) =>
                        setComponents((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, key: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="Floor rise"
                      value={component.key}
                    />
                    <input
                      aria-label={`Component ${index + 1} amount`}
                      className={inputClass}
                      onChange={(event) =>
                        setComponents((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, amount: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="Amount"
                      step="0.01"
                      type="number"
                      value={component.amount}
                    />
                    <button
                      aria-label={`Remove component ${index + 1}`}
                      className="grid size-9 place-items-center self-center rounded-lg text-[#737b77] hover:bg-[#ff665a]/10 hover:text-[#ff8f86]"
                      onClick={() =>
                        setComponents((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      type="button"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between border-y border-white/[0.08] py-4">
            <span className="text-sm text-[#818985]">Effective total</span>
            <span className="text-base font-semibold text-[#ecf0ed]">
              {money(Number.isFinite(total) ? total : 0, book.currency)}
            </span>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              className="h-10 rounded-lg border border-white/[0.12] px-4 text-sm font-medium text-[#bbc1be] hover:bg-white/[0.05]"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="flex h-10 min-w-28 items-center justify-center gap-2 rounded-lg bg-[#2b8d70] px-4 text-sm font-semibold text-white hover:bg-[#32a07f] disabled:opacity-50"
              disabled={busy}
              type="submit"
            >
              {busy && <LoaderCircle className="size-4 animate-spin" />}
              {editing ? "Save price" : "Add price"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeletePriceDialog({
  book,
  entry,
  onClose,
  onDeleted,
}: {
  book: PriceBook;
  entry: PriceEntry;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const target = entry.unit_code ?? entry.type_name ?? "this target";

  async function remove() {
    setBusy(true);
    try {
      await apiJson(`/api/inventory/prices/${entry.price_entry_id}`, {
        method: "DELETE",
      });
      toast.success("Price removed");
      await onDeleted();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to remove price",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[95] grid place-items-center bg-black/75 p-4 backdrop-blur-[3px]"
      role="dialog"
    >
      <div className="w-full max-w-[440px] rounded-2xl border border-white/[0.13] bg-[#111512] p-6 shadow-2xl">
        <div className="grid size-10 place-items-center rounded-xl bg-[#ff665a]/10 text-[#ff8f86]">
          <Trash2 className="size-5" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-white">Remove price?</h2>
        <p className="mt-2 text-sm leading-6 text-[#858d89]">
          The {book.price_book_name} price for {target} will be removed. The
          system will fall back to the next applicable price.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            className="h-10 rounded-lg border border-white/[0.12] px-4 text-sm text-[#bbc1be] hover:bg-white/[0.05]"
            onClick={onClose}
            type="button"
          >
            Keep price
          </button>
          <button
            className="flex h-10 items-center gap-2 rounded-lg bg-[#a63f36] px-4 text-sm font-semibold text-white hover:bg-[#bb493e] disabled:opacity-50"
            disabled={busy}
            onClick={() => void remove()}
            type="button"
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

export function InventoryPricingWorkspace({
  onChanged,
  onCreateBook,
  onEditBook,
  priceBooks,
  projectId,
  unitTypes,
}: {
  onChanged: () => Promise<void>;
  onCreateBook: () => void;
  onEditBook: (book: PriceBook) => void;
  priceBooks: PriceBook[];
  projectId: number;
  unitTypes: UnitType[];
}) {
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [entries, setEntries] = useState<PriceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<PriceEntry | "new" | null>(null);
  const [deleting, setDeleting] = useState<PriceEntry | null>(null);
  const [search, setSearch] = useState("");

  const resolvedSelectedBookId = priceBooks.some(
    (book) => book.price_book_id === selectedBookId,
  )
    ? selectedBookId
    : (priceBooks.find((book) => book.is_default)?.price_book_id ??
      priceBooks[0]?.price_book_id ??
      null);

  const selectedBook = priceBooks.find(
    (book) => book.price_book_id === resolvedSelectedBookId,
  );

  const loadEntries = useCallback(async () => {
    if (!resolvedSelectedBookId) {
      setEntries([]);
      return;
    }
    setLoading(true);
    try {
      const result = await apiJson<{ prices: PriceEntry[] }>(
        `/api/inventory/prices?price_book_id=${resolvedSelectedBookId}`,
      );
      setEntries(result.prices);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load prices",
      );
    } finally {
      setLoading(false);
    }
  }, [resolvedSelectedBookId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadEntries(), 0);
    return () => window.clearTimeout(timer);
  }, [loadEntries]);

  async function refreshPricing() {
    await Promise.all([loadEntries(), onChanged()]);
  }

  async function syncBasePrices() {
    if (!selectedBook) return;
    setSyncing(true);
    try {
      const result = await apiJson<{
        counts: Record<string, number>;
      }>("/api/inventory/price-books/sync-default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          currency: selectedBook.currency,
        }),
      });
      const changed =
        (result.counts.created ?? 0) + (result.counts.updated ?? 0);
      toast.success(
        changed
          ? `${changed} base ${changed === 1 ? "price" : "prices"} synchronized`
          : "Base prices are already synchronized",
      );
      await refreshPricing();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to synchronize prices",
      );
    } finally {
      setSyncing(false);
    }
  }

  const filteredEntries = entries.filter((entry) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [entry.type_name, entry.type_code, entry.unit_name, entry.unit_code]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });

  if (!priceBooks.length) {
    return (
      <div className="grid min-h-[360px] place-items-center border-y border-white/[0.08] py-16 text-center">
        <div className="max-w-sm">
          <div className="mx-auto grid size-11 place-items-center rounded-xl bg-white/[0.04] text-[#7e8782]">
            <CircleDollarSign className="size-5" />
          </div>
          <h2 className="mt-4 text-sm font-semibold text-white">
            No price books yet
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#747c78]">
            Create a standard, launch, channel, or limited-period price book.
          </p>
          <button
            className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-[#27896c] px-3.5 text-xs font-semibold text-white hover:bg-[#2f9d7c]"
            onClick={onCreateBook}
            type="button"
          >
            <Plus className="size-3.5" /> Create price book
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="pt-7">
      <div className="flex flex-wrap items-start justify-between gap-5 border-b border-white/[0.08] pb-6">
        <div>
          <h2 className="text-base font-semibold text-[#e8ebe9]">Pricing</h2>
          <p className="mt-1 text-sm text-[#747c78]">
            Base prices stay synchronized; add exceptions only where needed.
          </p>
        </div>
        <button
          className="flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.11] px-3 text-xs font-semibold text-[#c3c8c5] hover:bg-white/[0.05]"
          onClick={onCreateBook}
          type="button"
        >
          <Plus className="size-3.5" /> New price book
        </button>
      </div>

      <div className="grid min-h-[520px] grid-cols-[260px_minmax(0,1fr)] max-[860px]:grid-cols-1">
        <aside className="border-r border-white/[0.08] py-5 pr-5 max-[860px]:border-r-0 max-[860px]:border-b max-[860px]:pr-0">
          <p className="mb-2 px-2 text-[10px] font-semibold tracking-[0.13em] text-[#626a66] uppercase">
            Price books
          </p>
          <div className="space-y-1">
            {priceBooks.map((book) => (
              <button
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition ${resolvedSelectedBookId === book.price_book_id ? "bg-white/[0.065]" : "hover:bg-white/[0.035]"}`}
                key={book.price_book_id}
                onClick={() => setSelectedBookId(book.price_book_id)}
                type="button"
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-lg ${resolvedSelectedBookId === book.price_book_id ? "bg-[#57d6b1]/10 text-[#6bd7b7]" : "bg-white/[0.035] text-[#68706c]"}`}
                >
                  <BadgeIndianRupee className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-[#dce0dd]">
                      {book.price_book_name}
                    </span>
                    {book.is_default && (
                      <Check className="size-3.5 shrink-0 text-[#67dab8]" />
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[#68706c]">
                    {book.entry_count} prices · {book.currency}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        {selectedBook && (
          <div className="min-w-0 py-5 pl-6 max-[860px]:pl-0">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-[#edf0ee]">
                    {selectedBook.price_book_name}
                  </h3>
                  {selectedBook.is_default && (
                    <span className="rounded bg-[#57d6b1]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#73dfbf] uppercase">
                      Default
                    </span>
                  )}
                  {!selectedBook.is_active && (
                    <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-bold text-[#858d89] uppercase">
                      Inactive
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-[#6f7773]">
                  {selectedBook.price_book_code} · {selectedBook.currency}
                  {selectedBook.valid_from || selectedBook.valid_until
                    ? ` · ${shortDate(selectedBook.valid_from) ?? "No start"} — ${shortDate(selectedBook.valid_until) ?? "No end"}`
                    : " · No validity limit"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selectedBook.is_default && (
                  <button
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 text-xs font-medium text-[#aeb5b1] hover:bg-white/[0.045] disabled:opacity-50"
                    disabled={syncing}
                    onClick={() => void syncBasePrices()}
                    type="button"
                  >
                    <RefreshCw
                      className={`size-3.5 ${syncing ? "animate-spin" : ""}`}
                    />
                    Sync base prices
                  </button>
                )}
                <button
                  aria-label="Edit price book"
                  className="grid size-9 place-items-center rounded-lg border border-white/[0.1] text-[#929a96] hover:bg-white/[0.05] hover:text-white"
                  onClick={() => onEditBook(selectedBook)}
                  title="Edit price book"
                  type="button"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-[#27896c] px-3 text-xs font-semibold text-white hover:bg-[#2f9d7c] disabled:opacity-50"
                  disabled={!selectedBook.is_active}
                  onClick={() => setEditing("new")}
                  type="button"
                >
                  <Plus className="size-3.5" /> Add price
                </button>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3 border-y border-white/[0.08] py-3">
              <div className="relative max-w-sm flex-1">
                <Search className="absolute top-2.5 left-3 size-4 text-[#646d68]" />
                <input
                  className="h-9 w-full rounded-lg border border-white/[0.09] bg-[#0a0d0b] pr-3 pl-9 text-xs text-white outline-none placeholder:text-[#59605d] focus:border-[#57d6b1]/45"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search prices"
                  value={search}
                />
              </div>
              <span className="text-xs text-[#68706c]">
                {filteredEntries.length}{" "}
                {filteredEntries.length === 1 ? "price" : "prices"}
              </span>
            </div>

            {loading ? (
              <div className="grid min-h-56 place-items-center">
                <LoaderCircle className="size-5 animate-spin text-[#5ed5b2]" />
              </div>
            ) : filteredEntries.length ? (
              <div className="divide-y divide-white/[0.065]">
                {filteredEntries.map((entry) => (
                  <div
                    className="grid grid-cols-[minmax(0,1.4fr)_minmax(120px,.65fr)_minmax(130px,.7fr)_74px] items-center gap-4 py-4 max-[720px]:grid-cols-[minmax(0,1fr)_80px]"
                    key={entry.price_entry_id}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-[#dfe3e0]">
                          {entry.unit_code ?? entry.type_name}
                        </p>
                        <span className="rounded bg-white/[0.045] px-1.5 py-0.5 text-[9px] font-semibold text-[#7f8783] uppercase">
                          {entry.unit_id ? "Unit" : "Type"}
                        </span>
                        {entry.source === "unit_type_base" && (
                          <span className="rounded bg-[#57d6b1]/[0.08] px-1.5 py-0.5 text-[9px] font-semibold text-[#68cfb0] uppercase">
                            Synced
                          </span>
                        )}
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${priceTiming(entry, selectedBook).className}`}
                        >
                          {priceTiming(entry, selectedBook).label}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-[#68706c]">
                        {entry.unit_id
                          ? entry.unit_name || entry.type_name
                          : entry.type_code}
                      </p>
                    </div>
                    <div className="max-[720px]:text-right">
                      <p className="text-sm font-semibold text-[#e4e8e5]">
                        {money(entryTotal(entry), selectedBook.currency)}
                      </p>
                      {Object.keys(entry.components ?? {}).length > 0 && (
                        <p className="mt-0.5 text-[10px] text-[#6c746f]">
                          {Object.keys(entry.components).length} adjustments
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-[#7b837f] max-[720px]:hidden">
                      {entry.valid_from || entry.valid_until
                        ? `${shortDate(entry.valid_from) ?? "Any time"} — ${shortDate(entry.valid_until) ?? "No end"}`
                        : "Always effective"}
                    </p>
                    <div className="flex justify-end gap-1 max-[720px]:col-start-2">
                      <button
                        aria-label="Edit price"
                        className="grid size-8 place-items-center rounded-lg text-[#737c77] hover:bg-white/[0.05] hover:text-white"
                        onClick={() => setEditing(entry)}
                        title="Edit price"
                        type="button"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        aria-label="Remove price"
                        className="grid size-8 place-items-center rounded-lg text-[#737c77] hover:bg-[#ff665a]/10 hover:text-[#ff8f86]"
                        onClick={() => setDeleting(entry)}
                        title="Remove price"
                        type="button"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid min-h-64 place-items-center text-center">
                <div>
                  <p className="text-sm font-medium text-[#d5dad7]">
                    {search ? "No matching prices" : "No prices in this book"}
                  </p>
                  <p className="mt-1.5 text-xs text-[#707874]">
                    {search
                      ? "Try a different unit or unit-type name."
                      : "Synchronize base prices or add a manual price."}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedBook && editing && (
        <PriceEntryDialog
          book={selectedBook}
          editing={editing === "new" ? null : editing}
          key={editing === "new" ? "new" : editing.price_entry_id}
          onClose={() => setEditing(null)}
          onSaved={refreshPricing}
          projectId={projectId}
          unitTypes={unitTypes.filter((type) => type.is_active)}
        />
      )}
      {selectedBook && deleting && (
        <DeletePriceDialog
          book={selectedBook}
          entry={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={refreshPricing}
        />
      )}
    </section>
  );
}
