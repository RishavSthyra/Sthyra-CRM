"use client";

import {
  BadgeIndianRupee,
  CalendarClock,
  CheckCircle2,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  X,
  XCircle,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import toast from "react-hot-toast";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";

type Unit = {
  unit_id: string;
  unit_code: string;
  unit_name?: string | null;
  status: string;
  effective_price?: string | number | null;
  effective_price_currency?: string | null;
};

type Shortlist = {
  shortlist_id: string;
  title: string;
  items: Array<{
    unit_id: string;
    unit_code: string;
    unit_name?: string | null;
    amount?: number | null;
    currency?: string | null;
  }>;
};

type Hold = {
  hold_id: string;
  unit_id: string;
  status: string;
  expires_at: string;
};

type Reservation = {
  reservation_id: string;
  unit_id: string;
  status: string;
  booking_reference?: string | null;
  booking_status?: string;
  payment_status?: string;
  reservation_amount?: string | number | null;
  amount_paid?: string | number | null;
  currency?: string;
  expires_at?: string | null;
  unit_code?: string;
  unit_name?: string | null;
};

type Action =
  | { kind: "hold"; unit: Unit }
  | { kind: "reserve"; unit: Unit }
  | { kind: "cancel"; reservation: Reservation }
  | { kind: "payment"; reservation: Reservation };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithSession(url, {
    cache: "no-store",
    ...init,
  });
  if (!response.ok) throw new Error(await getApiError(response));
  return (await response.json()) as T;
}

function money(value: unknown, currency = "INR") {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function futureLocal(hours: number) {
  const date = new Date(Date.now() + hours * 60 * 60_000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function OpportunityBookingPanel({
  opportunityId,
  projectId,
  shortlists,
  units,
  onChanged,
}: {
  opportunityId: string;
  projectId: number;
  shortlists: Shortlist[];
  units: Unit[];
  onChanged: () => Promise<void>;
}) {
  const [holds, setHolds] = useState<Hold[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [form, setForm] = useState({
    expires_at: futureLocal(48),
    amount: "",
    reason: "",
    payment_status: "partial",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = `project_id=${projectId}&opportunity_id=${opportunityId}&limit=100`;
      const [holdData, reservationData] = await Promise.all([
        request<{ holds?: Hold[] }>(`/api/inventory/holds?${query}`),
        request<{ reservations?: Reservation[] }>(
          `/api/inventory/reservations?${query}`,
        ),
      ]);
      setHolds(holdData.holds ?? []);
      setReservations(reservationData.reservations ?? []);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to load booking records",
      );
    } finally {
      setLoading(false);
    }
  }, [opportunityId, projectId]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const shortlistUnits = useMemo(() => {
    const seen = new Set<string>();
    return shortlists.flatMap((shortlist) =>
      shortlist.items.flatMap((item) => {
        if (seen.has(item.unit_id)) return [];
        seen.add(item.unit_id);
        const live = units.find((unit) => unit.unit_id === item.unit_id);
        return [
          {
            unit_id: item.unit_id,
            unit_code: item.unit_code,
            unit_name: item.unit_name,
            status: live?.status ?? "unavailable",
            effective_price: live?.effective_price ?? item.amount,
            effective_price_currency:
              live?.effective_price_currency ?? item.currency ?? "INR",
          },
        ];
      }),
    );
  }, [shortlists, units]);

  async function run(
    id: string,
    url: string,
    body?: Record<string, unknown>,
    success = "Updated",
  ) {
    setBusyId(id);
    try {
      await request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      toast.success(success);
      window.dispatchEvent(new Event("notifications:changed"));
      setAction(null);
      await Promise.all([load(), onChanged()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  function open(next: Action) {
    const unit = "unit" in next ? next.unit : null;
    const reservation = "reservation" in next ? next.reservation : null;
    setForm({
      expires_at: futureLocal(next.kind === "hold" ? 48 : 24 * 7),
      amount: String(reservation?.amount_paid ?? unit?.effective_price ?? ""),
      reason: "",
      payment_status: reservation?.payment_status ?? "partial",
    });
    setAction(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action) return;
    if (action.kind === "hold")
      return run(
        action.unit.unit_id,
        `/api/inventory/units/${action.unit.unit_id}/hold`,
        {
          opportunity_id: opportunityId,
          expires_at: new Date(form.expires_at).toISOString(),
          reason: form.reason || "Held from opportunity workspace",
        },
        "Unit placed on hold",
      );
    if (action.kind === "reserve")
      return run(
        action.unit.unit_id,
        `/api/inventory/units/${action.unit.unit_id}/reserve`,
        {
          opportunity_id: opportunityId,
          reservation_amount: form.amount ? Number(form.amount) : null,
          currency: action.unit.effective_price_currency ?? "INR",
          expires_at: form.expires_at
            ? new Date(form.expires_at).toISOString()
            : null,
          notes: form.reason || null,
        },
        "Unit reserved",
      );
    if (action.kind === "cancel")
      return run(
        action.reservation.reservation_id,
        `/api/inventory/reservations/${action.reservation.reservation_id}/cancel`,
        { reason: form.reason },
        "Reservation cancelled",
      );
    setBusyId(action.reservation.reservation_id);
    try {
      await request(
        `/api/inventory/reservations/${action.reservation.reservation_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount_paid: Number(form.amount || 0),
            payment_status: form.payment_status,
          }),
        },
      );
      toast.success("Payment status updated");
      window.dispatchEvent(new Event("notifications:changed"));
      setAction(null);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to update payment",
      );
    } finally {
      setBusyId(null);
    }
  }

  const activeReservation = (unitId: string) =>
    reservations.find(
      (item) => item.unit_id === unitId && item.status === "active",
    );
  const activeHold = (unitId: string) =>
    holds.find((item) => item.unit_id === unitId && item.status === "active");
  const bookings = reservations.filter((item) => item.status === "converted");

  return (
    <section className="border-b border-white/[0.08] py-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.11em] text-[#68716c] uppercase">
            Booking workflow
          </p>
          <h4 className="mt-1 text-sm font-semibold text-[#e4e9e6]">
            Holds, reservations and payments
          </h4>
        </div>
        {loading && (
          <LoaderCircle className="size-4 animate-spin text-[#55d6b2]" />
        )}
      </div>

      {bookings.length > 0 && (
        <div className="mt-4 divide-y divide-white/[0.07] border-y border-white/[0.08]">
          {bookings.map((booking) => (
            <div
              className="flex items-center gap-3 py-3"
              key={booking.reservation_id}
            >
              <CheckCircle2 className="size-4 shrink-0 text-[#57d0ad]" />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-xs text-[#e0e5e2]">
                  {booking.unit_code ?? "Booked unit"}
                  {booking.booking_reference
                    ? ` · ${booking.booking_reference}`
                    : ""}
                </strong>
                <span className="mt-1 block text-[10px] capitalize text-[#737c77]">
                  Booking confirmed · {booking.payment_status ?? "unpaid"}
                </span>
              </span>
              <span className="text-right text-[10px] text-[#9da5a0]">
                {money(booking.amount_paid, booking.currency)} paid
              </span>
              <button
                className="text-[10px] font-semibold text-[#66d3b2]"
                onClick={() => open({ kind: "payment", reservation: booking })}
                type="button"
              >
                Payment
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 divide-y divide-white/[0.07]">
        {shortlistUnits.map((unit) => {
          const hold = activeHold(unit.unit_id);
          const reservation = activeReservation(unit.unit_id);
          return (
            <div
              className="flex flex-wrap items-center gap-2 py-3"
              key={unit.unit_id}
            >
              <span className="min-w-[150px] flex-1">
                <strong className="block text-xs text-[#dce2de]">
                  {unit.unit_code}
                </strong>
                <span className="mt-1 block text-[10px] capitalize text-[#6f7873]">
                  {unit.status} ·{" "}
                  {money(
                    unit.effective_price,
                    unit.effective_price_currency ?? "INR",
                  )}
                </span>
              </span>
              {unit.status === "available" && (
                <>
                  <button
                    className="flex h-8 items-center gap-1.5 rounded-md border border-white/[0.1] px-2.5 text-[10px] text-[#bdc4c0]"
                    onClick={() => open({ kind: "hold", unit })}
                    type="button"
                  >
                    <LockKeyhole className="size-3" /> Hold
                  </button>
                  <button
                    className="flex h-8 items-center gap-1.5 rounded-md bg-[#267c64] px-2.5 text-[10px] font-semibold text-white"
                    onClick={() => open({ kind: "reserve", unit })}
                    type="button"
                  >
                    <CalendarClock className="size-3" /> Reserve
                  </button>
                </>
              )}
              {unit.status === "held" && hold && (
                <>
                  <button
                    className="flex h-8 items-center gap-1.5 rounded-md border border-white/[0.1] px-2.5 text-[10px] text-[#bdc4c0]"
                    disabled={busyId === unit.unit_id}
                    onClick={() =>
                      void run(
                        unit.unit_id,
                        `/api/inventory/units/${unit.unit_id}/release`,
                        { reason: "Released from opportunity workspace" },
                        "Hold released",
                      )
                    }
                    type="button"
                  >
                    <RotateCcw className="size-3" /> Release
                  </button>
                  <button
                    className="h-8 rounded-md bg-[#267c64] px-2.5 text-[10px] font-semibold text-white"
                    onClick={() => open({ kind: "reserve", unit })}
                    type="button"
                  >
                    Reserve
                  </button>
                </>
              )}
              {unit.status === "reserved" && reservation && (
                <>
                  <button
                    className="h-8 rounded-md border border-[#7c4038] px-2.5 text-[10px] text-[#e89688]"
                    onClick={() => open({ kind: "cancel", reservation })}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="flex h-8 items-center gap-1.5 rounded-md bg-[#267c64] px-2.5 text-[10px] font-semibold text-white"
                    disabled={busyId === reservation.reservation_id}
                    onClick={() =>
                      void run(
                        reservation.reservation_id,
                        `/api/inventory/reservations/${reservation.reservation_id}/convert`,
                        undefined,
                        "Booking confirmed",
                      )
                    }
                    type="button"
                  >
                    <CheckCircle2 className="size-3" /> Confirm booking
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
      {!shortlistUnits.length && !loading && (
        <p className="mt-4 text-xs leading-5 text-[#6f7873]">
          Save an inventory shortlist first. Its units will become available for
          hold and reservation here.
        </p>
      )}

      {action && (
        <div
          className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setAction(null)
          }
        >
          <form
            className="w-full max-w-md rounded-xl border border-white/[0.12] bg-[#111512] shadow-2xl"
            onSubmit={submit}
          >
            <div className="flex items-start justify-between border-b border-white/[0.08] p-5">
              <div>
                <h3 className="text-base font-semibold capitalize text-white">
                  {action.kind === "payment"
                    ? "Record payment"
                    : `${action.kind} unit`}
                </h3>
                <p className="mt-1 text-xs text-[#737c77]">
                  {"unit" in action
                    ? action.unit.unit_code
                    : (action.reservation.unit_code ?? "Reservation")}
                </p>
              </div>
              <button
                className="text-[#818984]"
                onClick={() => setAction(null)}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              {(action.kind === "hold" || action.kind === "reserve") && (
                <label className="block text-xs text-[#aeb5b1]">
                  Expires
                  <input
                    className="mt-2 h-10 w-full rounded-lg border border-white/[0.1] bg-[#090c0a] px-3 text-sm text-white outline-none focus:border-[#4bc49f]"
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        expires_at: event.target.value,
                      }))
                    }
                    required
                    type="datetime-local"
                    value={form.expires_at}
                  />
                </label>
              )}
              {(action.kind === "reserve" || action.kind === "payment") && (
                <label className="block text-xs text-[#aeb5b1]">
                  {action.kind === "payment"
                    ? "Amount paid"
                    : "Reservation amount"}
                  <input
                    className="mt-2 h-10 w-full rounded-lg border border-white/[0.1] bg-[#090c0a] px-3 text-sm text-white outline-none focus:border-[#4bc49f]"
                    min="0"
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        amount: event.target.value,
                      }))
                    }
                    type="number"
                    value={form.amount}
                  />
                </label>
              )}
              {action.kind === "payment" && (
                <label className="block text-xs text-[#aeb5b1]">
                  Payment status
                  <select
                    className="mt-2 h-10 w-full rounded-lg border border-white/[0.1] bg-[#090c0a] px-3 text-sm text-white outline-none"
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        payment_status: event.target.value,
                      }))
                    }
                    value={form.payment_status}
                  >
                    <option value="unpaid">Unpaid</option>
                    <option value="partial">Partially paid</option>
                    <option value="paid">Paid</option>
                    <option value="refunded">Refunded</option>
                  </select>
                </label>
              )}
              {action.kind !== "payment" && (
                <label className="block text-xs text-[#aeb5b1]">
                  {action.kind === "cancel" ? "Cancellation reason" : "Notes"}
                  <textarea
                    className="mt-2 min-h-20 w-full resize-none rounded-lg border border-white/[0.1] bg-[#090c0a] p-3 text-sm text-white outline-none focus:border-[#4bc49f]"
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        reason: event.target.value,
                      }))
                    }
                    required={action.kind === "cancel"}
                    value={form.reason}
                  />
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/[0.08] p-4">
              <button
                className="h-9 px-3 text-xs text-[#aab2ad]"
                onClick={() => setAction(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="flex h-9 items-center gap-2 rounded-md bg-[#2b8d70] px-4 text-xs font-semibold text-white disabled:opacity-50"
                disabled={Boolean(busyId)}
                type="submit"
              >
                {busyId ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : action.kind === "cancel" ? (
                  <XCircle className="size-3.5" />
                ) : (
                  <BadgeIndianRupee className="size-3.5" />
                )}
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
