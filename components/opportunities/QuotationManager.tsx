"use client";

import {
  Check,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  History,
  LoaderCircle,
  Mail,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";

type LineItem = {
  line_item_id: string;
  unit_id: string | null;
  category: "base_price" | "floor_premium" | "parking" | "amenity" | "other";
  description: string;
  quantity: number;
  unit_price: number;
  amount?: number;
  unit_code?: string | null;
  unit_name?: string | null;
  type_name?: string | null;
};

type Tax = { tax_id: string; label: string; rate: number; amount?: number };
type Installment = {
  installment_id: string;
  label: string;
  percentage: number;
  amount?: number;
  due_date: string | null;
  trigger: string | null;
};

type Conversion = {
  conversion_id: string;
  target_type: "booking" | "agreement";
  status: string;
  created_at: string;
};

export type ManagedQuotation = {
  quotation_id: string;
  quotation_number: string;
  version: number;
  status: string;
  title?: string | null;
  currency: string;
  subtotal: string | number;
  charges_total?: string | number;
  discount_type?: "percentage" | "fixed" | null;
  discount_value?: string | number;
  discount_amount?: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  valid_until?: string | null;
  line_items: LineItem[];
  tax_breakdown?: Tax[];
  payment_plan?: {
    template_key?: string;
    template_name?: string;
    installments?: Installment[];
  };
  terms_and_conditions?: string | null;
  customer_message?: string | null;
  notes?: string | null;
  sent_at?: string | null;
  viewed_at?: string | null;
  accepted_at?: string | null;
  rejected_at?: string | null;
  created_at: string;
  updated_at?: string;
  conversions?: Conversion[];
};

type Shortlist = {
  shortlist_id: string;
  title: string;
  items: Array<{
    unit_id: string;
    unit_code: string;
    unit_name?: string | null;
    type_name?: string | null;
    amount?: number | null;
    currency?: string | null;
  }>;
};

type Opportunity = {
  opportunity_id: string;
  opportunity_name: string;
  email?: string | null;
  contact?: { email?: string | null };
};

type EventRow = {
  quotation_event_id: string;
  event_type: string;
  actor_display_name?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
  comment?: string | null;
  created_at: string;
};

type EmailConnection = {
  email_connection_id: string;
  email_address: string;
  display_name?: string | null;
  status: string;
  is_default: boolean;
};

type EditorState = {
  title: string;
  currency: string;
  valid_until: string;
  line_items: LineItem[];
  discount_type: "none" | "percentage" | "fixed";
  discount_value: number;
  tax_breakdown: Tax[];
  payment_plan: {
    template_key: string;
    template_name: string;
    installments: Installment[];
  };
  terms_and_conditions: string;
  customer_message: string;
  notes: string;
};

const inputClass =
  "h-10 w-full rounded-md border border-white/[0.11] bg-[#090d0b] px-3 text-sm text-[#e5e9e6] outline-none transition placeholder:text-[#59615d] focus:border-[#3b9d7f]";
const labelClass = "mb-1.5 block text-[11px] font-medium text-[#8e9792]";
const buttonClass =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/[0.1] px-3 text-xs font-semibold text-[#cbd1cd] transition hover:border-white/[0.18] hover:bg-white/[0.04] hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

function id() {
  return crypto.randomUUID();
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithSession(url, init);
  if (!response.ok) throw new Error(await getApiError(response));
  return response.json() as Promise<T>;
}

function money(value: string | number | undefined, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function date(value?: string | null, time = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

function emptyItem(category: LineItem["category"] = "other"): LineItem {
  return {
    line_item_id: id(),
    unit_id: null,
    category,
    description: "",
    quantity: 1,
    unit_price: 0,
  };
}

function initialEditor(shortlist?: Shortlist | null): EditorState {
  const valid = new Date();
  valid.setDate(valid.getDate() + 14);
  const items = shortlist?.items.length
    ? shortlist.items.map((item) => ({
        line_item_id: id(),
        unit_id: item.unit_id,
        category: "base_price" as const,
        description:
          item.unit_name ||
          item.unit_code ||
          item.type_name ||
          "Inventory unit",
        quantity: 1,
        unit_price: Number(item.amount ?? 0),
        unit_code: item.unit_code,
        unit_name: item.unit_name,
        type_name: item.type_name,
      }))
    : [emptyItem("base_price")];
  return {
    title: shortlist ? `${shortlist.title} quotation` : "Customer quotation",
    currency: shortlist?.items[0]?.currency || "INR",
    valid_until: valid.toISOString().slice(0, 10),
    line_items: items,
    discount_type: "none",
    discount_value: 0,
    tax_breakdown: [{ tax_id: id(), label: "GST", rate: 0 }],
    payment_plan: {
      template_key: "full",
      template_name: "Full payment",
      installments: [
        {
          installment_id: id(),
          label: "Full payment",
          percentage: 100,
          due_date: null,
          trigger: "On acceptance",
        },
      ],
    },
    terms_and_conditions:
      "Prices and availability are subject to confirmation at the time of booking.",
    customer_message:
      "Please review this quotation and contact us if you have any questions.",
    notes: "",
  };
}

function editorFromQuotation(quote: ManagedQuotation): EditorState {
  return {
    title: quote.title || "Customer quotation",
    currency: quote.currency,
    valid_until: quote.valid_until?.slice(0, 10) || "",
    line_items: (quote.line_items || []).map((item) => ({ ...item })),
    discount_type: quote.discount_type || "none",
    discount_value: Number(quote.discount_value || 0),
    tax_breakdown: (quote.tax_breakdown || []).map((item) => ({ ...item })),
    payment_plan: {
      template_key: quote.payment_plan?.template_key || "custom",
      template_name: quote.payment_plan?.template_name || "Custom",
      installments: (quote.payment_plan?.installments || []).map((item) => ({
        ...item,
      })),
    },
    terms_and_conditions: quote.terms_and_conditions || "",
    customer_message: quote.customer_message || "",
    notes: quote.notes || "",
  };
}

function Status({ value }: { value: string }) {
  const tones: Record<string, string> = {
    draft: "border-white/[0.1] bg-white/[0.04] text-[#9fa7a2]",
    sent: "border-[#3b7194]/40 bg-[#173149]/50 text-[#9bcdf0]",
    viewed: "border-[#765da6]/45 bg-[#2a2140]/55 text-[#c9b7ef]",
    accepted: "border-[#2b8d70]/45 bg-[#16372d]/60 text-[#6dd0ad]",
    rejected: "border-[#914a4a]/45 bg-[#351a1a]/60 text-[#e19b9b]",
    expired: "border-[#806a3e]/45 bg-[#312916]/60 text-[#d9bb78]",
    cancelled: "border-[#714747]/40 bg-[#2c1a1a]/60 text-[#c88b8b]",
  };
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold capitalize ${tones[value] || tones.draft}`}
    >
      {value}
    </span>
  );
}

function Modal({
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={`max-h-[94vh] w-full overflow-hidden rounded-xl border border-white/[0.12] bg-[#101512] shadow-2xl ${wide ? "max-w-[1360px]" : "max-w-xl"}`}
      >
        <header className="flex items-start justify-between border-b border-white/[0.08] px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            {description && (
              <p className="mt-1 text-xs text-[#7f8883]">{description}</p>
            )}
          </div>
          <button
            className="grid size-8 place-items-center rounded-md text-[#7f8883] hover:bg-white/[0.05] hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function QuotationEditor({
  opportunityId,
  quotation,
  shortlist,
  onClose,
  onSaved,
}: {
  opportunityId: string;
  quotation?: ManagedQuotation | null;
  shortlist?: Shortlist | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState(() =>
    quotation ? editorFromQuotation(quotation) : initialEditor(shortlist),
  );
  const [busy, setBusy] = useState(false);
  const subtotal = form.line_items.reduce(
    (sum, item) =>
      sum + Number(item.quantity || 0) * Number(item.unit_price || 0),
    0,
  );
  const discount =
    form.discount_type === "percentage"
      ? (subtotal * form.discount_value) / 100
      : form.discount_type === "fixed"
        ? form.discount_value
        : 0;
  const taxable = Math.max(0, subtotal - discount);
  const tax = form.tax_breakdown.reduce(
    (sum, item) => sum + (taxable * Number(item.rate || 0)) / 100,
    0,
  );
  const total = taxable + tax;

  function patchItem(index: number, next: Partial<LineItem>) {
    setForm((current) => ({
      ...current,
      line_items: current.line_items.map((item, position) =>
        position === index ? { ...item, ...next } : item,
      ),
    }));
  }

  function setPlan(key: string) {
    const plans: Record<
      string,
      { name: string; rows: Array<[string, number, string]> }
    > = {
      full: {
        name: "Full payment",
        rows: [["Full payment", 100, "On acceptance"]],
      },
      twenty_eighty: {
        name: "20 / 80 plan",
        rows: [
          ["Booking amount", 20, "On acceptance"],
          ["Balance", 80, "Before handover"],
        ],
      },
      thirty_forty_thirty: {
        name: "30 / 40 / 30 plan",
        rows: [
          ["Booking amount", 30, "On acceptance"],
          ["Construction milestone", 40, "At agreed milestone"],
          ["Final payment", 30, "Before handover"],
        ],
      },
      custom: {
        name: "Custom",
        rows: [
          ["First installment", 50, "On acceptance"],
          ["Final installment", 50, "Before handover"],
        ],
      },
    };
    const plan = plans[key] || plans.custom;
    setForm((current) => ({
      ...current,
      payment_plan: {
        template_key: key,
        template_name: plan.name,
        installments: plan.rows.map(([label, percentage, trigger]) => ({
          installment_id: id(),
          label,
          percentage,
          due_date: null,
          trigger,
        })),
      },
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        discount_type:
          form.discount_type === "none" ? null : form.discount_type,
        valid_until: form.valid_until || null,
      };
      const url = quotation
        ? `/api/opportunities/${opportunityId}/quotations/${quotation.quotation_id}`
        : `/api/opportunities/${opportunityId}/quotations`;
      await requestJson(url, {
        method: quotation ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast.success(
        quotation ? "Quotation draft updated" : "Quotation draft created",
      );
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save quotation",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      onClose={onClose}
      title={
        quotation
          ? `Edit ${quotation.quotation_number} · V${quotation.version}`
          : "New quotation"
      }
      description="Build an itemized, customer-ready commercial offer."
    >
      <form
        className="max-h-[calc(94vh-82px)] overflow-y-auto"
        onSubmit={submit}
      >
        <div className="grid px-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 lg:pr-8">
            <section className="grid gap-4 border-b border-white/[0.08] py-6 sm:grid-cols-[minmax(0,1fr)_110px_160px]">
              <label>
                <span className={labelClass}>Quotation title</span>
                <input
                  className={inputClass}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                  value={form.title}
                />
              </label>
              <label>
                <span className={labelClass}>Currency</span>
                <input
                  className={inputClass}
                  maxLength={3}
                  onChange={(e) =>
                    setForm({ ...form, currency: e.target.value.toUpperCase() })
                  }
                  value={form.currency}
                />
              </label>
              <label>
                <span className={labelClass}>Valid until</span>
                <input
                  className={inputClass}
                  onChange={(e) =>
                    setForm({ ...form, valid_until: e.target.value })
                  }
                  type="date"
                  value={form.valid_until}
                />
              </label>
            </section>

            <section className="border-b border-white/[0.08] py-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-[#e4e8e5]">
                    Line items
                  </h3>
                  <p className="mt-0.5 text-[11px] text-[#6f7773]">
                    Base price and every additional charge remain separately
                    visible.
                  </p>
                </div>
                <button
                  className={buttonClass}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      line_items: [...current.line_items, emptyItem()],
                    }))
                  }
                  type="button"
                >
                  <Plus className="size-3.5" /> Add item
                </button>
              </div>
              <div className="-mx-2 mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead className="border-y border-white/[0.07] bg-white/[0.018] text-[10px] uppercase tracking-[0.12em] text-[#6f7873]">
                    <tr>
                      <th className="px-3 py-2.5">Type</th>
                      <th className="px-3 py-2.5">Description</th>
                      <th className="w-20 px-3 py-2.5">Qty</th>
                      <th className="w-36 px-3 py-2.5">Unit price</th>
                      <th className="w-32 px-3 py-2.5 text-right">Amount</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {form.line_items.map((item, index) => (
                      <tr key={item.line_item_id}>
                        <td className="p-2">
                          <select
                            className={inputClass}
                            onChange={(e) =>
                              patchItem(index, {
                                category: e.target
                                  .value as LineItem["category"],
                              })
                            }
                            value={item.category}
                          >
                            <option value="base_price">Base price</option>
                            <option value="floor_premium">Floor premium</option>
                            <option value="parking">Parking</option>
                            <option value="amenity">Amenity</option>
                            <option value="other">Other charge</option>
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            className={inputClass}
                            onChange={(e) =>
                              patchItem(index, { description: e.target.value })
                            }
                            placeholder="Charge description"
                            required
                            value={item.description}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            className={inputClass}
                            min="0.01"
                            onChange={(e) =>
                              patchItem(index, {
                                quantity: Number(e.target.value),
                              })
                            }
                            step="0.01"
                            type="number"
                            value={item.quantity}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            className={inputClass}
                            min="0"
                            onChange={(e) =>
                              patchItem(index, {
                                unit_price: Number(e.target.value),
                              })
                            }
                            step="0.01"
                            type="number"
                            value={item.unit_price}
                          />
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-medium text-[#d8ddda]">
                          {money(
                            item.quantity * item.unit_price,
                            form.currency,
                          )}
                        </td>
                        <td className="p-2">
                          <button
                            aria-label="Remove line item"
                            className="grid size-8 place-items-center rounded-md text-[#935f5f] hover:bg-[#431f1f]/50 hover:text-[#e3a1a1] disabled:opacity-30"
                            disabled={form.line_items.length === 1}
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                line_items: current.line_items.filter(
                                  (_, position) => position !== index,
                                ),
                              }))
                            }
                            type="button"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid border-b border-white/[0.08] py-6 lg:grid-cols-2 lg:divide-x lg:divide-white/[0.08]">
              <div className="lg:pr-6">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#e4e8e5]">
                    Taxes
                  </h3>
                  <button
                    className={buttonClass}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        tax_breakdown: [
                          ...current.tax_breakdown,
                          { tax_id: id(), label: "", rate: 0 },
                        ],
                      }))
                    }
                    type="button"
                  >
                    <Plus className="size-3.5" /> Add
                  </button>
                </div>
                <div className="space-y-2">
                  {form.tax_breakdown.map((taxRow, index) => (
                    <div
                      className="grid grid-cols-[1fr_90px_32px] gap-2"
                      key={taxRow.tax_id}
                    >
                      <input
                        className={inputClass}
                        onChange={(e) =>
                          setForm((current) => ({
                            ...current,
                            tax_breakdown: current.tax_breakdown.map(
                              (row, position) =>
                                position === index
                                  ? { ...row, label: e.target.value }
                                  : row,
                            ),
                          }))
                        }
                        placeholder="GST / registration tax"
                        required
                        value={taxRow.label}
                      />
                      <div className="relative">
                        <input
                          className={`${inputClass} pr-7`}
                          max="100"
                          min="0"
                          onChange={(e) =>
                            setForm((current) => ({
                              ...current,
                              tax_breakdown: current.tax_breakdown.map(
                                (row, position) =>
                                  position === index
                                    ? { ...row, rate: Number(e.target.value) }
                                    : row,
                              ),
                            }))
                          }
                          step="0.01"
                          type="number"
                          value={taxRow.rate}
                        />
                        <span className="absolute right-3 top-2.5 text-xs text-[#69716d]">
                          %
                        </span>
                      </div>
                      <button
                        aria-label="Remove tax"
                        className="text-[#935f5f]"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            tax_breakdown: current.tax_breakdown.filter(
                              (_, position) => position !== index,
                            ),
                          }))
                        }
                        type="button"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-6 border-t border-white/[0.08] pt-6 lg:mt-0 lg:border-t-0 lg:pt-0 lg:pl-6">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-[#e4e8e5]">
                    Discount
                  </h3>
                  <p className="mt-0.5 text-[11px] text-[#6f7773]">
                    Apply a percentage or a fixed reduction.
                  </p>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-3">
                  <select
                    className={inputClass}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        discount_type: e.target
                          .value as EditorState["discount_type"],
                      })
                    }
                    value={form.discount_type}
                  >
                    <option value="none">No discount</option>
                    <option value="percentage">Percentage</option>
                    <option value="fixed">Fixed amount</option>
                  </select>
                  <input
                    className={inputClass}
                    disabled={form.discount_type === "none"}
                    max={form.discount_type === "percentage" ? 100 : undefined}
                    min="0"
                    onChange={(e) =>
                      setForm({
                        ...form,
                        discount_value: Number(e.target.value),
                      })
                    }
                    step="0.01"
                    type="number"
                    value={form.discount_value}
                  />
                </div>
              </div>
            </section>

            <section className="border-b border-white/[0.08] py-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-[#e4e8e5]">
                    Payment plan
                  </h3>
                  <p className="mt-0.5 text-[11px] text-[#6f7773]">
                    Installment percentages must total 100%.
                  </p>
                </div>
                <select
                  className={`${inputClass} w-48`}
                  onChange={(e) => setPlan(e.target.value)}
                  value={form.payment_plan.template_key}
                >
                  <option value="full">Full payment</option>
                  <option value="twenty_eighty">20 / 80 plan</option>
                  <option value="thirty_forty_thirty">30 / 40 / 30 plan</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="mt-4 hidden grid-cols-[minmax(0,1fr)_95px_minmax(0,1fr)_36px] gap-2 border-y border-white/[0.07] px-2 py-2.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#68716c] sm:grid">
                <span>Installment</span>
                <span>Share</span>
                <span>Due</span>
                <span />
              </div>
              <div className="mt-2 space-y-2">
                {form.payment_plan.installments.map((row, index) => (
                  <div
                    className="grid gap-2 sm:grid-cols-[1fr_95px_1fr_36px]"
                    key={row.installment_id}
                  >
                    <input
                      className={inputClass}
                      onChange={(e) =>
                        setForm((current) => ({
                          ...current,
                          payment_plan: {
                            ...current.payment_plan,
                            installments: current.payment_plan.installments.map(
                              (item, position) =>
                                position === index
                                  ? { ...item, label: e.target.value }
                                  : item,
                            ),
                          },
                        }))
                      }
                      placeholder="Installment"
                      required
                      value={row.label}
                    />
                    <div className="relative">
                      <input
                        className={`${inputClass} pr-7`}
                        max="100"
                        min="0"
                        onChange={(e) =>
                          setForm((current) => ({
                            ...current,
                            payment_plan: {
                              ...current.payment_plan,
                              installments:
                                current.payment_plan.installments.map(
                                  (item, position) =>
                                    position === index
                                      ? {
                                          ...item,
                                          percentage: Number(e.target.value),
                                        }
                                      : item,
                                ),
                            },
                          }))
                        }
                        step="0.01"
                        type="number"
                        value={row.percentage}
                      />
                      <span className="absolute right-3 top-2.5 text-xs text-[#69716d]">
                        %
                      </span>
                    </div>
                    <input
                      className={inputClass}
                      onChange={(e) =>
                        setForm((current) => ({
                          ...current,
                          payment_plan: {
                            ...current.payment_plan,
                            installments: current.payment_plan.installments.map(
                              (item, position) =>
                                position === index
                                  ? { ...item, trigger: e.target.value }
                                  : item,
                            ),
                          },
                        }))
                      }
                      placeholder="Due trigger"
                      value={row.trigger || ""}
                    />
                    <button
                      className="text-[#935f5f] disabled:opacity-30"
                      disabled={form.payment_plan.installments.length === 1}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          payment_plan: {
                            ...current.payment_plan,
                            template_key: "custom",
                            template_name: "Custom",
                            installments:
                              current.payment_plan.installments.filter(
                                (_, position) => position !== index,
                              ),
                          },
                        }))
                      }
                      type="button"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                className={`${buttonClass} mt-3`}
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    payment_plan: {
                      ...current.payment_plan,
                      template_key: "custom",
                      template_name: "Custom",
                      installments: [
                        ...current.payment_plan.installments,
                        {
                          installment_id: id(),
                          label: "",
                          percentage: 0,
                          due_date: null,
                          trigger: "",
                        },
                      ],
                    },
                  }))
                }
                type="button"
              >
                <Plus className="size-3.5" /> Add installment
              </button>
            </section>

            <section className="grid gap-5 py-6 sm:grid-cols-2">
              <label>
                <span className={labelClass}>Customer message</span>
                <textarea
                  className={`${inputClass} min-h-28 py-3`}
                  onChange={(e) =>
                    setForm({ ...form, customer_message: e.target.value })
                  }
                  value={form.customer_message}
                />
              </label>
              <label>
                <span className={labelClass}>Internal notes</span>
                <textarea
                  className={`${inputClass} min-h-28 py-3`}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  value={form.notes}
                />
              </label>
              <label className="sm:col-span-2">
                <span className={labelClass}>Terms and conditions</span>
                <textarea
                  className={`${inputClass} min-h-32 py-3`}
                  onChange={(e) =>
                    setForm({ ...form, terms_and_conditions: e.target.value })
                  }
                  value={form.terms_and_conditions}
                />
              </label>
            </section>
          </div>

          <aside className="h-fit border-t border-white/[0.08] py-6 lg:sticky lg:top-0 lg:border-t-0 lg:border-l lg:py-6 lg:pl-7">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#68716c]">
              Quotation summary
            </p>
            <dl className="mt-5 space-y-3 text-xs">
              <div className="flex justify-between text-[#9da5a0]">
                <dt>Subtotal</dt>
                <dd>{money(subtotal, form.currency)}</dd>
              </div>
              <div className="flex justify-between text-[#9da5a0]">
                <dt>Discount</dt>
                <dd className="text-[#d19b8c]">
                  − {money(discount, form.currency)}
                </dd>
              </div>
              {form.tax_breakdown.map((row) => (
                <div
                  className="flex justify-between text-[#9da5a0]"
                  key={row.tax_id}
                >
                  <dt>
                    {row.label || "Tax"} ({row.rate}%)
                  </dt>
                  <dd>{money((taxable * row.rate) / 100, form.currency)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-white/[0.09] pt-4 text-base font-semibold text-white">
                <dt>Total</dt>
                <dd>{money(total, form.currency)}</dd>
              </div>
            </dl>
            <div className="mt-6 border-t border-white/[0.08] pt-4 text-[10px] leading-5 text-[#76817c]">
              Once sent or accepted, this version becomes read-only. Further
              changes require a new revision.
            </div>
          </aside>
        </div>
        <footer className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-white/[0.08] bg-[#101512]/95 px-6 py-4 backdrop-blur">
          <button className={buttonClass} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2b8d70] px-4 text-xs font-semibold text-white hover:bg-[#329b7c] disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            {busy && <LoaderCircle className="size-3.5 animate-spin" />}
            {quotation ? "Save changes" : "Create draft"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function SendDialog({
  opportunity,
  quotation,
  onClose,
  onSent,
}: {
  opportunity: Opportunity;
  quotation: ManagedQuotation;
  onClose: () => void;
  onSent: () => Promise<void>;
}) {
  const [connections, setConnections] = useState<EmailConnection[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    email_connection_id: "",
    to: opportunity.contact?.email || opportunity.email || "",
    subject: `${quotation.quotation_number} — ${quotation.title || opportunity.opportunity_name}`,
    message:
      quotation.customer_message || "Please review the attached quotation.",
    validity_days: 30,
  });
  useEffect(() => {
    void requestJson<{ connections?: EmailConnection[] }>(
      "/api/email-connections",
    )
      .then((payload) => {
        const active = (payload.connections || []).filter(
          (item) => item.status === "connected",
        );
        setConnections(active);
        setForm((current) => ({
          ...current,
          email_connection_id:
            active.find((item) => item.is_default)?.email_connection_id ||
            active[0]?.email_connection_id ||
            "",
        }));
      })
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "Unable to load mailboxes",
        ),
      )
      .finally(() => setLoading(false));
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await requestJson<{ share_url?: string }>(
        `/api/opportunities/${opportunity.opportunity_id}/quotations/${quotation.quotation_id}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      toast.success("Quotation sent by email");
      if (result.share_url)
        await navigator.clipboard
          .writeText(result.share_url)
          .catch(() => undefined);
      await onSent();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to send quotation",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      onClose={onClose}
      title="Send quotation"
      description="A branded PDF and secure review link will be included."
    >
      <form className="space-y-4 p-6" onSubmit={submit}>
        <label>
          <span className={labelClass}>From</span>
          <select
            className={inputClass}
            disabled={loading}
            onChange={(e) =>
              setForm({ ...form, email_connection_id: e.target.value })
            }
            required
            value={form.email_connection_id}
          >
            <option value="">Select connected mailbox</option>
            {connections.map((item) => (
              <option
                key={item.email_connection_id}
                value={item.email_connection_id}
              >
                {item.display_name ? `${item.display_name} — ` : ""}
                {item.email_address}
              </option>
            ))}
          </select>
          {!loading && !connections.length && (
            <p className="mt-2 text-xs text-[#d09b79]">
              Connect a mailbox in Settings before sending.
            </p>
          )}
        </label>
        <label>
          <span className={labelClass}>To</span>
          <input
            className={inputClass}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
            required
            type="email"
            value={form.to}
          />
        </label>
        <label>
          <span className={labelClass}>Subject</span>
          <input
            className={inputClass}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            required
            value={form.subject}
          />
        </label>
        <label>
          <span className={labelClass}>Message</span>
          <textarea
            className={`${inputClass} min-h-28 py-3`}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            value={form.message}
          />
        </label>
        <label>
          <span className={labelClass}>Secure link valid for</span>
          <select
            className={inputClass}
            onChange={(e) =>
              setForm({ ...form, validity_days: Number(e.target.value) })
            }
            value={form.validity_days}
          >
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
          </select>
        </label>
        <div className="flex justify-end gap-3 pt-2">
          <button className={buttonClass} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2b8d70] px-4 text-xs font-semibold text-white disabled:opacity-50"
            disabled={busy || !connections.length}
            type="submit"
          >
            {busy ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}{" "}
            Send quotation
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DetailDialog({
  opportunityId,
  quotation,
  onClose,
  onChanged,
  onEdit,
  onSend,
}: {
  opportunityId: string;
  quotation: ManagedQuotation;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onEdit: () => void;
  onSend: () => void;
}) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    void requestJson<{ events?: EventRow[] }>(
      `/api/opportunities/${opportunityId}/quotations/${quotation.quotation_id}`,
    )
      .then((result) => setEvents(result.events || []))
      .catch(() => undefined);
  }, [opportunityId, quotation.quotation_id]);
  async function action(
    kind: "share" | "revise" | "cancel" | "agreement" | "booking",
  ) {
    setBusy(kind);
    try {
      if (kind === "share") {
        const result = await requestJson<{ share_url: string }>(
          `/api/opportunities/${opportunityId}/quotations/${quotation.quotation_id}/share`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ validity_days: 30 }),
          },
        );
        await navigator.clipboard.writeText(result.share_url);
        toast.success("Secure customer link copied");
      } else if (kind === "revise") {
        const reason =
          window.prompt("Reason for this revision (optional)") || "";
        await requestJson(
          `/api/opportunities/${opportunityId}/quotations/${quotation.quotation_id}/revise`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ revision_reason: reason }),
          },
        );
        toast.success("New editable revision created");
      } else if (kind === "cancel") {
        const reason = window.prompt("Cancellation reason");
        if (!reason) return;
        await requestJson(
          `/api/opportunities/${opportunityId}/quotations/${quotation.quotation_id}/status`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "cancel", comment: reason }),
          },
        );
        toast.success("Quotation cancelled");
      } else if (kind === "agreement") {
        await requestJson(
          `/api/opportunities/${opportunityId}/quotations/${quotation.quotation_id}/convert`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target_type: "agreement" }),
          },
        );
        toast.success("Agreement-ready snapshot created");
      } else {
        const units = quotation.line_items.filter((item) => item.unit_id);
        if (!units.length)
          throw new Error("This quotation has no inventory unit to book");
        const chosen =
          units.length === 1
            ? units[0].unit_id
            : window.prompt(
                `Enter unit ID to book:\n${units.map((item) => `${item.unit_code || item.description}: ${item.unit_id}`).join("\n")}`,
              );
        if (!chosen) return;
        await requestJson(
          `/api/opportunities/${opportunityId}/quotations/${quotation.quotation_id}/convert`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target_type: "booking", unit_id: chosen }),
          },
        );
        toast.success("Booking created from accepted quotation");
      }
      await onChanged();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to complete action",
      );
    } finally {
      setBusy("");
    }
  }
  async function pdf(download: boolean) {
    setBusy(download ? "download" : "preview");
    try {
      const response = await fetchWithSession(
        `/api/opportunities/${opportunityId}/quotations/${quotation.quotation_id}/pdf`,
      );
      if (!response.ok) throw new Error(await getApiError(response));
      const url = URL.createObjectURL(await response.blob());
      if (download) {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${quotation.quotation_number}-V${quotation.version}.pdf`;
        anchor.click();
      } else window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to open PDF",
      );
    } finally {
      setBusy("");
    }
  }
  const immutable = quotation.status !== "draft";
  return (
    <Modal
      wide
      onClose={onClose}
      title={`${quotation.quotation_number} · V${quotation.version}`}
      description={quotation.title || "Customer quotation"}
    >
      <div className="max-h-[calc(94vh-82px)] overflow-y-auto">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] px-6 py-4">
          <Status value={quotation.status} />
          {!immutable && (
            <button className={buttonClass} onClick={onEdit} type="button">
              <Pencil className="size-3.5" /> Edit draft
            </button>
          )}
          <button
            className={buttonClass}
            disabled={!!busy}
            onClick={() => void pdf(false)}
            type="button"
          >
            <ExternalLink className="size-3.5" /> Preview PDF
          </button>
          <button
            className={buttonClass}
            disabled={!!busy}
            onClick={() => void pdf(true)}
            type="button"
          >
            <Download className="size-3.5" /> Download
          </button>
          {!["rejected", "expired", "cancelled"].includes(quotation.status) && (
            <>
              <button
                className={buttonClass}
                disabled={!!busy}
                onClick={() => void action("share")}
                type="button"
              >
                <Copy className="size-3.5" /> Copy secure link
              </button>
              <button className={buttonClass} onClick={onSend} type="button">
                <Mail className="size-3.5" /> Send email
              </button>
            </>
          )}
          {immutable && (
            <button
              className={buttonClass}
              disabled={!!busy}
              onClick={() => void action("revise")}
              type="button"
            >
              <RefreshCw className="size-3.5" /> Create revision
            </button>
          )}
          {!["accepted", "rejected", "expired", "cancelled"].includes(
            quotation.status,
          ) && (
            <button
              className={`${buttonClass} text-[#c48f8f]`}
              disabled={!!busy}
              onClick={() => void action("cancel")}
              type="button"
            >
              Cancel
            </button>
          )}
        </div>
        {quotation.status === "accepted" && (
          <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.08] bg-[#143128]/35 px-6 py-4">
            <Check className="size-4 text-[#57bd99]" />
            <p className="mr-auto text-xs text-[#9fd5c1]">
              Accepted quotations are locked. Create a revision for any
              commercial change.
            </p>
            <button
              className={buttonClass}
              disabled={
                !!busy ||
                quotation.conversions?.some(
                  (item) => item.target_type === "agreement",
                )
              }
              onClick={() => void action("agreement")}
              type="button"
            >
              <ReceiptText className="size-3.5" /> Prepare agreement
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2b8d70] px-3 text-xs font-semibold text-white disabled:opacity-50"
              disabled={
                !!busy ||
                quotation.conversions?.some(
                  (item) => item.target_type === "booking",
                )
              }
              onClick={() => void action("booking")}
              type="button"
            >
              <Check className="size-3.5" /> Create booking
            </button>
          </div>
        )}
        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="space-y-6">
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#737c77]">
                Commercial breakdown
              </h3>
              <div className="overflow-hidden rounded-lg border border-white/[0.08]">
                <table className="w-full text-left">
                  <thead className="bg-white/[0.025] text-[10px] uppercase tracking-[0.11em] text-[#6d7571]">
                    <tr>
                      <th className="px-4 py-3">Item</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {quotation.line_items.map((item) => (
                      <tr key={item.line_item_id}>
                        <td className="px-4 py-3 text-sm text-[#d8ddda]">
                          {item.description}
                          {item.unit_code && (
                            <span className="ml-2 text-[10px] text-[#747c78]">
                              {item.unit_code}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs capitalize text-[#858e89]">
                          {item.category.replaceAll("_", " ")}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-[#d8ddda]">
                          {money(
                            item.amount ?? item.quantity * item.unit_price,
                            quotation.currency,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {quotation.payment_plan?.installments?.length ? (
              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#737c77]">
                  Payment plan
                </h3>
                <div className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.08]">
                  {quotation.payment_plan.installments.map((item) => (
                    <div
                      className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3"
                      key={item.installment_id}
                    >
                      <span>
                        <strong className="block text-xs text-[#d9deda]">
                          {item.label}
                        </strong>
                        <small className="text-[11px] text-[#747c78]">
                          {item.trigger || item.due_date || "As agreed"}
                        </small>
                      </span>
                      <span className="text-right">
                        <strong className="block text-xs text-[#d9deda]">
                          {item.percentage}%
                        </strong>
                        <small className="text-[11px] text-[#747c78]">
                          {money(item.amount, quotation.currency)}
                        </small>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {quotation.terms_and_conditions && (
              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#737c77]">
                  Terms and conditions
                </h3>
                <p className="whitespace-pre-wrap rounded-lg border border-white/[0.08] p-4 text-xs leading-6 text-[#9ca49f]">
                  {quotation.terms_and_conditions}
                </p>
              </section>
            )}
          </div>
          <aside>
            <div className="rounded-lg border border-white/[0.08] bg-[#0b100d] p-4">
              <dl className="space-y-3 text-xs">
                <div className="flex justify-between text-[#929a95]">
                  <dt>Subtotal</dt>
                  <dd>{money(quotation.subtotal, quotation.currency)}</dd>
                </div>
                {Number(quotation.discount_amount || 0) > 0 && (
                  <div className="flex justify-between text-[#c48f82]">
                    <dt>Discount</dt>
                    <dd>
                      − {money(quotation.discount_amount, quotation.currency)}
                    </dd>
                  </div>
                )}
                {(quotation.tax_breakdown || []).map((row) => (
                  <div
                    className="flex justify-between text-[#929a95]"
                    key={row.tax_id}
                  >
                    <dt>
                      {row.label} ({row.rate}%)
                    </dt>
                    <dd>{money(row.amount, quotation.currency)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-white/[0.08] pt-4 text-base font-semibold text-white">
                  <dt>Total</dt>
                  <dd>{money(quotation.total_amount, quotation.currency)}</dd>
                </div>
              </dl>
              <div className="mt-4 border-t border-white/[0.08] pt-4 text-[11px] text-[#747c78]">
                <p>
                  Valid until{" "}
                  <span className="float-right text-[#a9b0ac]">
                    {date(quotation.valid_until)}
                  </span>
                </p>
                <p className="mt-2">
                  Created{" "}
                  <span className="float-right text-[#a9b0ac]">
                    {date(quotation.created_at)}
                  </span>
                </p>
              </div>
            </div>
            <section className="mt-6">
              <div className="mb-3 flex items-center gap-2">
                <History className="size-4 text-[#69726d]" />
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#737c77]">
                  Activity
                </h3>
              </div>
              <div className="space-y-0">
                {events.length ? (
                  events.map((event) => (
                    <div
                      className="relative border-l border-white/[0.1] pb-4 pl-4"
                      key={event.quotation_event_id}
                    >
                      <span className="absolute -left-1 top-1 size-2 rounded-full bg-[#3b9679]" />
                      <strong className="block text-xs capitalize text-[#cbd0cd]">
                        {event.event_type.replaceAll("_", " ")}
                      </strong>
                      <span className="mt-1 block text-[10px] text-[#6f7773]">
                        {event.actor_display_name ||
                          event.actor_name ||
                          event.actor_email ||
                          "Customer"}{" "}
                        · {date(event.created_at, true)}
                      </span>
                      {event.comment && (
                        <p className="mt-1.5 text-[11px] leading-5 text-[#8e9691]">
                          {event.comment}
                        </p>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-[#69716d]">
                    No recorded activity.
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </Modal>
  );
}

export function QuotationManager({
  opportunity,
  shortlists,
  quotations,
  onChanged,
}: {
  opportunity: Opportunity;
  shortlists: Shortlist[];
  quotations: ManagedQuotation[];
  onChanged: () => Promise<void>;
}) {
  const [editor, setEditor] = useState<{
    quotation?: ManagedQuotation;
    shortlist?: Shortlist;
  } | null>(null);
  const [detail, setDetail] = useState<ManagedQuotation | null>(null);
  const [sending, setSending] = useState<ManagedQuotation | null>(null);
  const [selectedShortlist, setSelectedShortlist] = useState(
    shortlists[0]?.shortlist_id || "",
  );
  const grouped = useMemo(
    () =>
      quotations.reduce<Record<string, ManagedQuotation[]>>((groups, quote) => {
        (groups[quote.quotation_number] ||= []).push(quote);
        return groups;
      }, {}),
    [quotations],
  );
  function newQuote() {
    setEditor({
      shortlist: shortlists.find(
        (item) => item.shortlist_id === selectedShortlist,
      ),
    });
  }
  return (
    <div>
      <div className="flex flex-col gap-4 border-b border-white/[0.08] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-[#e7ebe8]">Quotations</h3>
          <p className="mt-1 max-w-xl text-xs leading-5 text-[#747c78]">
            Itemized offers, customer approvals, revisions, PDF delivery and
            conversion history.
          </p>
        </div>
        <div className="flex gap-2">
          {shortlists.length > 0 && (
            <select
              className={`${inputClass} w-48`}
              onChange={(e) => setSelectedShortlist(e.target.value)}
              value={selectedShortlist}
            >
              <option value="">Blank quotation</option>
              {shortlists.map((item) => (
                <option key={item.shortlist_id} value={item.shortlist_id}>
                  From: {item.title}
                </option>
              ))}
            </select>
          )}
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-[#2b8d70] px-4 text-xs font-semibold text-white hover:bg-[#329b7c]"
            onClick={newQuote}
            type="button"
          >
            <FilePlus2 className="size-4" /> New quotation
          </button>
        </div>
      </div>
      {quotations.length ? (
        <div className="mt-5 overflow-hidden rounded-lg border border-white/[0.08]">
          <div className="grid grid-cols-[minmax(0,1.4fr)_100px_120px_130px_28px] gap-3 bg-white/[0.025] px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#69726d]">
            <span>Quotation</span>
            <span>Status</span>
            <span>Customer activity</span>
            <span className="text-right">Total</span>
            <span />
          </div>
          <div className="divide-y divide-white/[0.07]">
            {Object.values(grouped).flatMap((versions) =>
              versions
                .sort((a, b) => b.version - a.version)
                .map((quote, index) => (
                  <button
                    className={`grid w-full grid-cols-[minmax(0,1.4fr)_100px_120px_130px_28px] items-center gap-3 px-4 py-4 text-left transition hover:bg-white/[0.025] ${index > 0 ? "bg-black/10" : ""}`}
                    key={quote.quotation_id}
                    onClick={() => setDetail(quote)}
                    type="button"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        className={`grid size-9 shrink-0 place-items-center rounded-md ${index === 0 ? "bg-[#18382e] text-[#63bd9c]" : "bg-white/[0.04] text-[#77807b]"}`}
                      >
                        <FileText className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <strong className="block truncate text-sm text-[#dce1de]">
                          {quote.quotation_number}{" "}
                          <span className="font-normal text-[#77807b]">
                            V{quote.version}
                          </span>
                        </strong>
                        <small className="mt-1 block truncate text-[11px] text-[#6d7571]">
                          {quote.title || "Customer quotation"}
                          {index > 0
                            ? " · Previous revision"
                            : " · Latest revision"}
                        </small>
                      </span>
                    </span>
                    <span>
                      <Status value={quote.status} />
                    </span>
                    <span className="text-[11px] text-[#89918c]">
                      {quote.accepted_at
                        ? `Accepted ${date(quote.accepted_at)}`
                        : quote.rejected_at
                          ? `Rejected ${date(quote.rejected_at)}`
                          : quote.viewed_at
                            ? `Viewed ${date(quote.viewed_at)}`
                            : quote.sent_at
                              ? `Sent ${date(quote.sent_at)}`
                              : "Not sent"}
                    </span>
                    <span className="text-right">
                      <strong className="block text-sm text-[#dce1de]">
                        {money(quote.total_amount, quote.currency)}
                      </strong>
                      <small className="mt-1 block text-[10px] text-[#6d7571]">
                        Valid {date(quote.valid_until)}
                      </small>
                    </span>
                    <ChevronRight className="size-4 text-[#59615d]" />
                  </button>
                )),
            )}
          </div>
        </div>
      ) : (
        <div className="mt-5 grid min-h-64 place-items-center rounded-lg border border-dashed border-white/[0.1]">
          <div className="max-w-sm text-center">
            <span className="mx-auto grid size-11 place-items-center rounded-lg bg-white/[0.04] text-[#7d8681]">
              <ReceiptText className="size-5" />
            </span>
            <h4 className="mt-4 text-sm font-semibold text-[#d8ddda]">
              No quotations yet
            </h4>
            <p className="mt-1.5 text-xs leading-5 text-[#707874]">
              Start with a saved shortlist or create an itemized quotation from
              scratch.
            </p>
            <button
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-[#2b8d70] px-4 text-xs font-semibold text-white"
              onClick={newQuote}
              type="button"
            >
              <Plus className="size-3.5" /> Create quotation
            </button>
          </div>
        </div>
      )}
      {editor && (
        <QuotationEditor
          onClose={() => setEditor(null)}
          onSaved={onChanged}
          opportunityId={opportunity.opportunity_id}
          quotation={editor.quotation}
          shortlist={editor.shortlist}
        />
      )}
      {detail && (
        <DetailDialog
          onChanged={onChanged}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditor({ quotation: detail });
            setDetail(null);
          }}
          onSend={() => setSending(detail)}
          opportunityId={opportunity.opportunity_id}
          quotation={detail}
        />
      )}
      {sending && (
        <SendDialog
          onClose={() => setSending(null)}
          onSent={async () => {
            await onChanged();
            setDetail(null);
          }}
          opportunity={opportunity}
          quotation={sending}
        />
      )}
    </div>
  );
}
