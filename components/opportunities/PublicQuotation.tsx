"use client";

import {
  Check,
  CheckCircle2,
  Download,
  FileText,
  LoaderCircle,
  X,
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
  }).format(new Date(String(value)));
}

async function responseJson(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; details?: string[]; quotation?: RecordValue; message?: string }
    | null;
  if (!response.ok)
    throw new Error(
      payload?.details?.length
        ? payload.details.join(". ")
        : payload?.error || "Unable to load quotation",
    );
  return payload;
}

export function PublicQuotation({ token }: { token: string }) {
  const [quotation, setQuotation] = useState<RecordValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [responseMode, setResponseMode] = useState<"accept" | "reject" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    reason: "",
    comment: "",
  });

  useEffect(() => {
    let active = true;
    void fetch(`/api/public/quotations/${encodeURIComponent(token)}`, {
      cache: "no-store",
    })
      .then(responseJson)
      .then((payload) => {
        if (!active) return;
        const quote = payload?.quotation ?? null;
        setQuotation(quote);
        const customer =
          quote && typeof quote.customer === "object" && quote.customer
            ? (quote.customer as RecordValue)
            : null;
        setForm((current) => ({
          ...current,
          name: customer
            ? `${String(customer.first_name || "")} ${String(customer.last_name || "")}`.trim()
            : "",
          email: customer ? String(customer.email || "") : "",
        }));
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Unable to load quotation");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const lineItems = useMemo(
    () =>
      Array.isArray(quotation?.line_items)
        ? (quotation.line_items as RecordValue[])
        : [],
    [quotation],
  );
  const taxes = useMemo(
    () =>
      Array.isArray(quotation?.tax_breakdown)
        ? (quotation.tax_breakdown as RecordValue[])
        : [],
    [quotation],
  );
  const installments = useMemo(() => {
    const plan = quotation?.payment_plan;
    return plan && typeof plan === "object" && !Array.isArray(plan)
      ? Array.isArray((plan as RecordValue).installments)
        ? ((plan as RecordValue).installments as RecordValue[])
        : []
      : [];
  }, [quotation]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!responseMode) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await responseJson(
        await fetch(`/api/public/quotations/${encodeURIComponent(token)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: responseMode, ...form }),
        }),
      );
      setComplete(payload?.message || "Your response has been recorded");
      setQuotation((current) =>
        current ? { ...current, status: responseMode === "accept" ? "accepted" : "rejected" } : current,
      );
      setResponseMode(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save response");
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <main className="grid min-h-screen place-items-center bg-[#f5f7f6] text-[#55605b]">
        <span className="flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" /> Loading quotation…
        </span>
      </main>
    );
  if (error && !quotation)
    return (
      <main className="grid min-h-screen place-items-center bg-[#f5f7f6] px-6">
        <div className="max-w-md rounded-xl border border-[#dfe5e2] bg-white p-8 text-center shadow-sm">
          <FileText className="mx-auto size-8 text-[#9aa39f]" />
          <h1 className="mt-4 text-xl font-semibold text-[#17201d]">Quotation unavailable</h1>
          <p className="mt-2 text-sm text-[#67716d]">{error}</p>
        </div>
      </main>
    );
  if (!quotation) return null;

  const status = String(quotation.status || "draft");
  const canRespond = status === "sent" || status === "viewed";
  const plan = quotation.payment_plan as RecordValue | undefined;

  return (
    <main className="min-h-screen bg-[#f5f7f6] text-[#17201d]">
      <header className="border-b border-[#dfe5e2] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-[#287b63] uppercase">
              {String(quotation.company_name || "STHYRA CRM")}
            </p>
            <p className="mt-1 text-sm text-[#66706c]">Customer quotation</p>
          </div>
          <a
            className="flex h-10 items-center gap-2 rounded-md border border-[#cfd7d3] bg-white px-4 text-sm font-medium hover:bg-[#f5f7f6]"
            href={`/api/public/quotations/${encodeURIComponent(token)}/pdf`}
          >
            <Download className="size-4" /> Download PDF
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        <section className="rounded-xl border border-[#dfe5e2] bg-white shadow-sm">
          <div className="border-b border-[#e5eae7] px-6 py-7 sm:px-9">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
                    {String(quotation.title)}
                  </h1>
                  <span className="rounded-full bg-[#eef4f1] px-2.5 py-1 text-[11px] font-semibold text-[#287b63] capitalize">
                    {status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[#68716d]">
                  {String(quotation.quotation_number)} · Version {String(quotation.version)}
                </p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-xs text-[#7b8580]">Total</p>
                <p className="mt-1 text-2xl font-semibold text-[#287b63]">
                  {money(quotation.total_amount, quotation.currency)}
                </p>
                <p className="mt-1 text-xs text-[#7b8580]">
                  Valid until {date(quotation.valid_until)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-6 border-b border-[#e5eae7] px-6 py-6 sm:grid-cols-2 sm:px-9">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.12em] text-[#7b8580] uppercase">Prepared for</p>
              <p className="mt-2 font-medium">
                {`${String((quotation.customer as RecordValue)?.first_name || "")} ${String((quotation.customer as RecordValue)?.last_name || "")}`.trim() || "Customer"}
              </p>
              <p className="mt-1 text-sm text-[#68716d]">
                {String((quotation.customer as RecordValue)?.email || "")}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-[0.12em] text-[#7b8580] uppercase">Project</p>
              <p className="mt-2 font-medium">{String(quotation.project_name)}</p>
              <p className="mt-1 text-sm text-[#68716d]">{String(quotation.project_code)}</p>
            </div>
          </div>

          {quotation.customer_message ? (
            <div className="border-b border-[#e5eae7] bg-[#fafbf9] px-6 py-5 text-sm leading-6 text-[#4e5954] sm:px-9">
              {String(quotation.customer_message)}
            </div>
          ) : null}

          <div className="px-6 py-7 sm:px-9">
            <h2 className="text-base font-semibold">Pricing</h2>
            <div className="mt-4 overflow-hidden rounded-lg border border-[#dfe5e2]">
              <div className="hidden grid-cols-[1fr_90px_130px_130px] bg-[#f5f7f6] px-4 py-3 text-[11px] font-semibold tracking-[0.08em] text-[#6b7570] uppercase sm:grid">
                <span>Description</span><span>Qty</span><span>Unit price</span><span className="text-right">Amount</span>
              </div>
              {lineItems.map((item, index) => (
                <div className="grid gap-2 border-t border-[#e5eae7] px-4 py-4 first:border-t-0 sm:grid-cols-[1fr_90px_130px_130px] sm:items-center" key={String(item.line_item_id || index)}>
                  <div>
                    <p className="text-sm font-medium">{String(item.description)}</p>
                    <p className="mt-1 text-xs capitalize text-[#7b8580]">{String(item.category || "other").replaceAll("_", " ")}</p>
                  </div>
                  <span className="text-sm text-[#59635e]">{String(item.quantity)}</span>
                  <span className="text-sm text-[#59635e]">{money(item.unit_price, quotation.currency)}</span>
                  <strong className="text-sm sm:text-right">{money(item.amount, quotation.currency)}</strong>
                </div>
              ))}
            </div>

            <div className="ml-auto mt-5 max-w-sm space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-[#68716d]">Subtotal</span><span>{money(quotation.subtotal, quotation.currency)}</span></div>
              {Number(quotation.discount_amount || 0) > 0 ? <div className="flex justify-between"><span className="text-[#68716d]">Discount</span><span>-{money(quotation.discount_amount, quotation.currency)}</span></div> : null}
              {taxes.map((tax, index) => <div className="flex justify-between" key={String(tax.tax_id || index)}><span className="text-[#68716d]">{String(tax.label)} ({String(tax.rate)}%)</span><span>{money(tax.amount, quotation.currency)}</span></div>)}
              <div className="flex justify-between border-t border-[#dfe5e2] pt-3 text-base font-semibold"><span>Total</span><span className="text-[#287b63]">{money(quotation.total_amount, quotation.currency)}</span></div>
            </div>
          </div>

          {installments.length ? (
            <div className="border-t border-[#e5eae7] px-6 py-7 sm:px-9">
              <h2 className="text-base font-semibold">Payment plan</h2>
              <p className="mt-1 text-sm text-[#68716d]">{String(plan?.template_name || "Custom")}</p>
              <div className="mt-4 divide-y divide-[#e5eae7] border-y border-[#e5eae7]">
                {installments.map((item, index) => (
                  <div className="flex items-center justify-between gap-4 py-3 text-sm" key={String(item.installment_id || index)}>
                    <div><p className="font-medium">{String(item.label)}</p><p className="mt-0.5 text-xs text-[#7b8580]">{item.due_date ? `Due ${date(item.due_date)}` : item.trigger ? String(item.trigger) : "Due as agreed"}</p></div>
                    <div className="text-right"><p className="font-medium">{money(item.amount, quotation.currency)}</p><p className="text-xs text-[#7b8580]">{String(item.percentage)}%</p></div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {quotation.terms_and_conditions ? (
            <div className="border-t border-[#e5eae7] px-6 py-7 sm:px-9">
              <h2 className="text-base font-semibold">Terms and conditions</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#59635e]">{String(quotation.terms_and_conditions)}</p>
            </div>
          ) : null}
        </section>

        {complete ? (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-[#b8dccc] bg-[#edf8f3] p-4 text-sm text-[#215f4d]">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" /> {complete}
          </div>
        ) : null}
        {error && quotation ? (
          <div className="mt-6 rounded-lg border border-[#efc8c4] bg-[#fff5f4] p-4 text-sm text-[#a13f37]">{error}</div>
        ) : null}

        {canRespond && !complete ? (
          <section className="mt-6 rounded-xl border border-[#dfe5e2] bg-white p-6 shadow-sm sm:p-8">
            {!responseMode ? (
              <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
                <div><h2 className="text-lg font-semibold">Ready to respond?</h2><p className="mt-1 text-sm text-[#68716d]">Your response is recorded against this exact quotation version.</p></div>
                <div className="flex gap-3">
                  <button className="flex h-11 items-center gap-2 rounded-md border border-[#d5a8a3] px-5 text-sm font-medium text-[#9a4038] hover:bg-[#fff5f4]" onClick={() => setResponseMode("reject")} type="button"><X className="size-4" /> Request changes</button>
                  <button className="flex h-11 items-center gap-2 rounded-md bg-[#287b63] px-5 text-sm font-semibold text-white hover:bg-[#216b56]" onClick={() => setResponseMode("accept")} type="button"><Check className="size-4" /> Accept quotation</button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit}>
                <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{responseMode === "accept" ? "Accept quotation" : "Request changes"}</h2><button className="text-sm text-[#68716d]" onClick={() => setResponseMode(null)} type="button">Cancel</button></div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm"><span className="mb-2 block font-medium">Full name</span><input className="h-11 w-full rounded-md border border-[#cfd7d3] px-3 outline-none focus:border-[#287b63]" onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} /></label>
                  <label className="text-sm"><span className="mb-2 block font-medium">Email</span><input className="h-11 w-full rounded-md border border-[#cfd7d3] px-3 outline-none focus:border-[#287b63]" onChange={(event) => setForm({ ...form, email: event.target.value })} required type="email" value={form.email} /></label>
                  {responseMode === "reject" ? <label className="text-sm sm:col-span-2"><span className="mb-2 block font-medium">Reason</span><select className="h-11 w-full rounded-md border border-[#cfd7d3] bg-white px-3 outline-none focus:border-[#287b63]" onChange={(event) => setForm({ ...form, reason: event.target.value })} required value={form.reason}><option value="">Select a reason</option><option>Pricing needs revision</option><option>Payment plan needs revision</option><option>Inventory selection changed</option><option>Terms need revision</option><option>Not proceeding</option><option>Other</option></select></label> : null}
                  <label className="text-sm sm:col-span-2"><span className="mb-2 block font-medium">Comment {responseMode === "accept" ? "(optional)" : ""}</span><textarea className="min-h-24 w-full resize-y rounded-md border border-[#cfd7d3] p-3 outline-none focus:border-[#287b63]" onChange={(event) => setForm({ ...form, comment: event.target.value })} value={form.comment} /></label>
                </div>
                <button className={`mt-5 flex h-11 items-center justify-center gap-2 rounded-md px-5 text-sm font-semibold text-white ${responseMode === "accept" ? "bg-[#287b63] hover:bg-[#216b56]" : "bg-[#9a4038] hover:bg-[#84362f]"}`} disabled={busy} type="submit">{busy ? <LoaderCircle className="size-4 animate-spin" /> : responseMode === "accept" ? <Check className="size-4" /> : <X className="size-4" />}{busy ? "Saving…" : responseMode === "accept" ? "Confirm acceptance" : "Submit response"}</button>
              </form>
            )}
          </section>
        ) : null}
        <p className="py-8 text-center text-xs text-[#87908c]">Secure quotation powered by Sthyra CRM</p>
      </div>
    </main>
  );
}
