"use client";

import {
  Building2,
  CheckCircle2,
  FileCheck2,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type RecordValue = Record<string, unknown>;

function money(value: unknown, currency: unknown) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: String(currency || "INR"),
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function date(value: unknown) {
  if (!value) return "Not specified";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(String(value)));
}

async function responseJson(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | {
        error?: string;
        details?: string[];
        booking_form?: RecordValue;
        message?: string;
        booking_reference?: string;
      }
    | null;
  if (!response.ok)
    throw new Error(
      payload?.details?.length
        ? payload.details.join(". ")
        : payload?.error || "Unable to load booking form",
    );
  return payload;
}

const inputClass =
  "mt-2 h-12 w-full rounded-lg border border-[#cfd7d3] bg-white px-3.5 text-[15px] text-[#17201d] outline-none transition placeholder:text-[#9aa39f] focus:border-[#287b63] focus:ring-2 focus:ring-[#287b63]/10";

export function PublicBookingForm({ token }: { token: string }) {
  const [booking, setBooking] = useState<RecordValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", confirmed: false });

  useEffect(() => {
    let active = true;
    void fetch(`/api/public/bookings/${encodeURIComponent(token)}`, {
      cache: "no-store",
    })
      .then(responseJson)
      .then((payload) => {
        if (!active) return;
        const record = payload?.booking_form ?? null;
        setBooking(record);
        if (record) {
          setForm({
            name: String(record.customer_name || ""),
            phone: String(record.phone_number || ""),
            confirmed: false,
          });
          setComplete(
            record.status === "submitted" || record.status === "confirmed",
          );
        }
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Unable to load booking form",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const installments = useMemo(() => {
    const plan = booking?.payment_plan;
    return plan && typeof plan === "object" && !Array.isArray(plan)
      ? Array.isArray((plan as RecordValue).installments)
        ? ((plan as RecordValue).installments as RecordValue[])
        : []
      : [];
  }, [booking]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = await responseJson(
        await fetch(`/api/public/bookings/${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }),
      );
      setBooking((current) =>
        current
          ? {
              ...current,
              status: "submitted",
              booking_reference:
                payload?.booking_reference || current.booking_reference,
            }
          : current,
      );
      setComplete(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to submit booking form",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f7f5] text-[#55605b]">
        <span className="flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" /> Loading booking form…
        </span>
      </main>
    );

  if (error && !booking)
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f7f5] px-6">
        <div className="max-w-md rounded-2xl border border-[#dfe5e2] bg-white p-8 text-center shadow-sm">
          <FileCheck2 className="mx-auto size-9 text-[#9aa39f]" />
          <h1 className="mt-4 text-xl font-semibold text-[#17201d]">
            Booking form unavailable
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#67716d]">{error}</p>
        </div>
      </main>
    );
  if (!booking) return null;

  const plan = booking.payment_plan as RecordValue | undefined;

  return (
    <main className="min-h-screen bg-[#f4f7f5] text-[#17201d]">
      <header className="border-b border-[#dfe5e2] bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#287b63]">
              {String(booking.company_name || "STHYRA CRM")}
            </p>
            <p className="mt-1 text-sm text-[#66706c]">Secure booking form</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#68716d]">
            <LockKeyhole className="size-4 text-[#287b63]" /> Protected link
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
        {complete ? (
          <section className="rounded-2xl border border-[#b8dccc] bg-white p-8 text-center shadow-sm sm:p-12">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#e9f7f1] text-[#287b63]">
              <CheckCircle2 className="size-7" />
            </span>
            <h1 className="mt-5 text-2xl font-semibold tracking-[-0.02em]">
              Booking form submitted
            </h1>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#68716d]">
              {booking.status === "confirmed"
                ? "The sales team has verified your submission and confirmed the booking."
                : "Your details have been sent to the sales team. They will verify the submission and confirm the booking."}
            </p>
            <div className="mx-auto mt-6 max-w-sm rounded-xl bg-[#f4f7f5] px-5 py-4">
              <p className="text-xs text-[#7b8580]">Booking reference</p>
              <p className="mt-1 font-semibold text-[#287b63]">
                {String(booking.booking_reference)}
              </p>
            </div>
          </section>
        ) : (
          <>
            <section className="overflow-hidden rounded-2xl border border-[#dfe5e2] bg-white shadow-sm">
              <div className="border-b border-[#e5eae7] px-6 py-7 sm:px-9">
                <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
                  <div>
                    <p className="text-xs font-medium text-[#287b63]">
                      {String(booking.booking_reference)}
                    </p>
                    <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
                      Confirm your booking details
                    </h1>
                    <p className="mt-2 text-sm text-[#68716d]">
                      {String(booking.project_name)} · Quotation {String(booking.quotation_number)} V{String(booking.quotation_version)}
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-xs text-[#7b8580]">Link expires</p>
                    <p className="mt-1 text-sm font-medium">
                      {date(booking.expires_at)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-px bg-[#e5eae7] sm:grid-cols-2">
                {[
                  ["Configuration", booking.configuration],
                  ["Flat number", booking.flat_number],
                  ["Agreed price", money(booking.agreed_price, booking.currency)],
                  ["Booking amount", money(booking.booking_amount, booking.currency)],
                ].map(([label, value]) => (
                  <div className="bg-white px-6 py-5 sm:px-9" key={String(label)}>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#7b8580]">
                      {String(label)}
                    </p>
                    <p className="mt-2 text-base font-semibold">{String(value)}</p>
                  </div>
                ))}
              </div>

              <div className="border-t border-[#e5eae7] px-6 py-7 sm:px-9">
                <div className="flex items-center gap-2">
                  <Building2 className="size-4 text-[#287b63]" />
                  <h2 className="font-semibold">Payment plan</h2>
                </div>
                <p className="mt-1 text-sm text-[#68716d]">
                  {String(plan?.template_name || "Agreed payment plan")}
                </p>
                {installments.length ? (
                  <div className="mt-4 overflow-hidden rounded-lg border border-[#dfe5e2]">
                    {installments.map((item, index) => (
                      <div
                        className="flex items-center justify-between gap-4 border-t border-[#e5eae7] px-4 py-3.5 text-sm first:border-t-0"
                        key={String(item.installment_id || index)}
                      >
                        <div>
                          <p className="font-medium">{String(item.label)}</p>
                          <p className="mt-0.5 text-xs text-[#7b8580]">
                            {item.due_date
                              ? `Due ${date(item.due_date)}`
                              : item.trigger
                                ? String(item.trigger)
                                : "Due as agreed"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">
                            {money(item.amount, booking.currency)}
                          </p>
                          <p className="text-xs text-[#7b8580]">
                            {String(item.percentage)}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-lg bg-[#f4f7f5] p-4 text-sm text-[#68716d]">
                    Payment terms are as recorded in the accepted quotation.
                  </p>
                )}
              </div>
            </section>

            <form
              className="mt-6 rounded-2xl border border-[#dfe5e2] bg-white p-6 shadow-sm sm:p-9"
              onSubmit={submit}
            >
              <h2 className="text-lg font-semibold">Your contact details</h2>
              <p className="mt-1 text-sm leading-6 text-[#68716d]">
                Confirm who is submitting this form. The commercial details above
                are locked to the accepted quotation.
              </p>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Name
                  <input
                    autoComplete="name"
                    className={inputClass}
                    maxLength={250}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, name: event.target.value }))
                    }
                    required
                    value={form.name}
                  />
                </label>
                <label className="text-sm font-medium">
                  Phone number
                  <input
                    autoComplete="tel"
                    className={inputClass}
                    inputMode="tel"
                    maxLength={40}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, phone: event.target.value }))
                    }
                    required
                    type="tel"
                    value={form.phone}
                  />
                </label>
              </div>
              <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-lg border border-[#dfe5e2] bg-[#f8faf9] p-4 text-sm leading-6 text-[#4f5a55]">
                <input
                  checked={form.confirmed}
                  className="mt-1 size-4 accent-[#287b63]"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      confirmed: event.target.checked,
                    }))
                  }
                  required
                  type="checkbox"
                />
                I confirm that the configuration, flat number, agreed price,
                booking amount, and payment plan shown above are correct.
              </label>
              {error ? (
                <div className="mt-5 rounded-lg border border-[#efc8c4] bg-[#fff5f4] p-4 text-sm text-[#a13f37]">
                  {error}
                </div>
              ) : null}
              <div className="mt-6 flex flex-col-reverse items-stretch justify-between gap-4 sm:flex-row sm:items-center">
                <p className="flex items-center gap-2 text-xs text-[#7b8580]">
                  <LockKeyhole className="size-3.5" /> Your response is recorded securely.
                </p>
                <button
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#287b63] px-6 text-sm font-semibold text-white transition hover:bg-[#216b56] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={busy || !form.confirmed}
                  type="submit"
                >
                  {busy ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <FileCheck2 className="size-4" />
                  )}
                  {busy ? "Submitting…" : "Submit booking form"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
