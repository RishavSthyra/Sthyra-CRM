"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";

export type ContactProfile = {
  contact_id?: string;
  first_name?: string;
  last_name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  company_works_at?: string | null;
  occupation?: string | null;
  date_of_birth?: string | null;
  marital_status?:
    | "single"
    | "married"
    | "separated"
    | "divorced"
    | "widowed"
    | "prefer_not_to_say"
    | null;
  anniversary_date?: string | null;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

export type ContactProfileWrite = Pick<
  ContactProfile,
  | "company_works_at"
  | "occupation"
  | "date_of_birth"
  | "marital_status"
  | "anniversary_date"
  | "address"
  | "city"
  | "district"
  | "state"
  | "postal_code"
  | "country"
>;

type Props = {
  name: string;
  profile: ContactProfile;
  onSave: (profile: ContactProfileWrite) => Promise<void>;
};

const maritalOptions = [
  ["", "Not added"],
  ["single", "Single"],
  ["married", "Married"],
  ["separated", "Separated"],
  ["divorced", "Divorced"],
  ["widowed", "Widowed"],
  ["prefer_not_to_say", "Prefer not to say"],
] as const;

function emptyToNull(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

function dateLabel(value?: string | null) {
  if (!value) return "Not added";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function profileValue(value?: string | null) {
  return value?.trim() || "Not added";
}

function maritalLabel(value?: ContactProfile["marital_status"]) {
  return (
    maritalOptions.find(([option]) => option === (value ?? ""))?.[1] ??
    "Not added"
  );
}

function residenceLabel(profile: ContactProfile) {
  const locality = [
    profile.city,
    profile.district,
    profile.state,
    profile.postal_code,
    profile.country,
  ]
    .filter(Boolean)
    .join(", ");
  return [profile.address, locality].filter(Boolean).join(" · ") || "Not added";
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const isEmpty = value === "Not added";
  return (
    <div className="grid min-h-11 grid-cols-[112px_minmax(0,1fr)] items-center gap-3 border-b border-white/[0.07] py-2.5 last:border-b-0">
      <p className="text-[10px] font-medium tracking-[0.08em] text-[#858b88] uppercase">
        {label}
      </p>
      <p
        className={`truncate text-right text-[12px] leading-5 ${isEmpty ? "text-[#6f7572]" : "text-[#ecefed]"}`}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

type PanelPosition = {
  dockedLeft: boolean;
  left: number;
  pointerTop: number;
  top: number;
  width: number;
};

export function ContactProfilePopover({ name, profile, onSave }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState<ContactProfileWrite>({});
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
        setEditing(false);
      }
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        setEditing(false);
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function placePanel() {
      const anchor = rootRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const drawer = rootRef.current
        ?.closest("aside")
        ?.getBoundingClientRect();
      const gap = 14;
      const desiredWidth = 352;
      const leftBoundary = drawer?.left ?? anchor.left;
      const availableLeft = leftBoundary - gap;
      const dockedLeft = availableLeft >= 316;
      const width = dockedLeft
        ? Math.min(desiredWidth, availableLeft - 16)
        : Math.min(desiredWidth, window.innerWidth - 32);
      const left = dockedLeft
        ? leftBoundary - gap - width
        : Math.max(16, Math.min(anchor.left, window.innerWidth - width - 16));
      const top = Math.max(16, Math.min(anchor.top - 14, window.innerHeight - 180));
      const pointerTop = Math.max(
        24,
        Math.min(72, anchor.top + anchor.height / 2 - top - 7),
      );
      setPanelPosition({ dockedLeft, left, pointerTop, top, width });
    }

    placePanel();
    window.addEventListener("resize", placePanel);
    window.addEventListener("scroll", placePanel, true);
    return () => {
      window.removeEventListener("resize", placePanel);
      window.removeEventListener("scroll", placePanel, true);
    };
  }, [open]);

  function beginEditing() {
    setSaveError(null);
    setForm({
      company_works_at: profile.company_works_at ?? "",
      occupation: profile.occupation ?? "",
      date_of_birth: profile.date_of_birth ?? "",
      marital_status: profile.marital_status ?? null,
      anniversary_date: profile.anniversary_date ?? "",
      address: profile.address ?? "",
      city: profile.city ?? "",
      district: profile.district ?? "",
      state: profile.state ?? "",
      postal_code: profile.postal_code ?? "",
      country: profile.country ?? "",
    });
    setEditing(true);
  }

  function setField<K extends keyof ContactProfileWrite>(
    field: K,
    value: ContactProfileWrite[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        company_works_at: emptyToNull(String(form.company_works_at ?? "")),
        occupation: emptyToNull(String(form.occupation ?? "")),
        date_of_birth: emptyToNull(String(form.date_of_birth ?? "")),
        marital_status: form.marital_status || null,
        anniversary_date: emptyToNull(
          String(form.anniversary_date ?? ""),
        ),
        address: emptyToNull(String(form.address ?? "")),
        city: emptyToNull(String(form.city ?? "")),
        district: emptyToNull(String(form.district ?? "")),
        state: emptyToNull(String(form.state ?? "")),
        postal_code: emptyToNull(String(form.postal_code ?? "")),
        country: emptyToNull(String(form.country ?? "")),
      });
      setEditing(false);
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : "Unable to save contact profile",
      );
    } finally {
      setSaving(false);
    }
  }

  const initials = `${name[0] || "?"}${name.split(" ")[1]?.[0] || ""}`.toUpperCase();

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Open contact profile for ${name}`}
        className="group relative flex size-12 items-center justify-center rounded-full border border-transparent bg-[#363636] text-sm text-[#f5f5f5] transition hover:border-[#5a625e] hover:bg-[#414341] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8c9691]"
        onClick={() => {
          setOpen((value) => !value);
          setEditing(false);
        }}
        type="button"
      >
        {initials}
        <span className="absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full border border-[#111] bg-[#e8ebe9] text-[#151716] opacity-85 transition group-hover:opacity-100">
          <Pencil aria-hidden className="size-2.5" strokeWidth={2.2} />
        </span>
      </button>

      {open && panelPosition && typeof document !== "undefined"
        ? createPortal(
        <section
          aria-label={`${name} contact profile`}
          className="fixed z-[110] flex max-h-[calc(100vh-32px)] flex-col rounded-lg border border-[#333634] bg-[#171817] shadow-[0_24px_70px_rgba(0,0,0,0.58)]"
          onMouseDown={(event) => event.stopPropagation()}
          ref={panelRef}
          role="dialog"
          style={{
            left: panelPosition.left,
            top: panelPosition.top,
            width: panelPosition.width,
          }}
        >
          {panelPosition.dockedLeft ? (
            <span
              aria-hidden
              className="absolute right-[-7px] size-3.5 rotate-45 border-t border-r border-[#333634] bg-[#171817]"
              style={{ top: panelPosition.pointerTop }}
            />
          ) : null}
          <header className="flex shrink-0 items-start justify-between border-b border-white/[0.08] px-4 py-3.5">
            <div className="min-w-0 pr-3">
              <p className="text-[10px] font-medium tracking-[0.14em] text-[#858b88] uppercase">
                Contact profile
              </p>
              <h3 className="mt-1 truncate text-sm font-semibold text-[#f1f3f2]">
                {name}
              </h3>
              <p className="mt-0.5 text-[11px] text-[#858b88]">
                Personal and residence details
              </p>
            </div>
            <div className="flex items-center gap-1">
              {!editing ? (
                <button
                  aria-label="Edit contact profile"
                  className="flex size-8 items-center justify-center rounded-md border border-[#3a3e3c] bg-white/[0.03] text-[#cbd0cd] transition hover:bg-white/[0.08]"
                  onClick={beginEditing}
                  type="button"
                >
                  <Pencil aria-hidden className="size-3.5" />
                </button>
              ) : null}
              <button
                aria-label="Close contact profile"
                className="flex size-8 items-center justify-center rounded-md border-0 bg-transparent text-[#959b98] hover:bg-white/[0.06] hover:text-white"
                onClick={() => {
                  setOpen(false);
                  setEditing(false);
                }}
                type="button"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          </header>

          {editing ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={save}>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-1 [scrollbar-color:#444_transparent]">
                <ProfileInput
                  label="Occupation"
                  onChange={(value) => setField("occupation", value)}
                  value={form.occupation}
                />
                <ProfileInput
                  label="Employer"
                  onChange={(value) => setField("company_works_at", value)}
                  value={form.company_works_at}
                />
                <ProfileInput
                  label="Birthday"
                  onChange={(value) => setField("date_of_birth", value)}
                  type="date"
                  value={form.date_of_birth}
                />
                <label className="grid min-h-12 grid-cols-[112px_minmax(0,1fr)] items-center gap-3 border-b border-white/[0.07] py-2 text-[10px] font-medium tracking-[0.05em] text-[#969c99] uppercase">
                  <span>Marital status</span>
                  <select
                    className="h-9 min-w-0 rounded-md border border-[#383c3a] bg-[#0f100f] px-2.5 text-[12px] normal-case tracking-normal text-[#eceeed] outline-none focus:border-[#777f7b]"
                    onChange={(event) =>
                      setField(
                        "marital_status",
                        (event.target.value || null) as ContactProfile["marital_status"],
                      )
                    }
                    value={form.marital_status ?? ""}
                  >
                    {maritalOptions.map(([value, option]) => (
                      <option key={value} value={value}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <ProfileInput
                  label="Anniversary"
                  onChange={(value) => setField("anniversary_date", value)}
                  type="date"
                  value={form.anniversary_date}
                />
                <ProfileInput
                  label="City"
                  onChange={(value) => setField("city", value)}
                  value={form.city}
                />
                <ProfileInput
                  label="District"
                  onChange={(value) => setField("district", value)}
                  value={form.district}
                />
                <ProfileInput
                  label="State"
                  onChange={(value) => setField("state", value)}
                  value={form.state}
                />
                <ProfileInput
                  label="PIN / postal code"
                  onChange={(value) => setField("postal_code", value)}
                  value={form.postal_code}
                />
                <ProfileInput
                  label="Country"
                  onChange={(value) => setField("country", value)}
                  value={form.country}
                />
                <ProfileInput
                  label="Home address"
                  onChange={(value) => setField("address", value)}
                  value={form.address}
                />
              </div>
              {saveError ? (
                <p className="mx-4 mb-3 rounded-md border border-[#693c3c] bg-[#2b1717] px-3 py-2 text-[11px] text-[#f0a8a8]">
                  {saveError}
                </p>
              ) : null}
              <footer className="flex justify-end gap-2 border-t border-white/[0.08] px-4 py-3">
                <button
                  className="h-9 rounded-md border border-[#3a3e3c] px-3.5 text-[11px] font-medium text-[#c5cac7] hover:bg-white/[0.05]"
                  onClick={() => setEditing(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-9 rounded-md bg-[#ecefed] px-4 text-[11px] font-semibold text-[#141615] disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={saving}
                  type="submit"
                >
                  {saving ? "Saving…" : "Save contact"}
                </button>
              </footer>
            </form>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-1 [scrollbar-color:#444_transparent]">
              <DetailRow
                label="Phone"
                value={profileValue(profile.phone_number)}
              />
              <DetailRow
                label="Email"
                value={profileValue(profile.email)}
              />
              <DetailRow
                label="Occupation"
                value={profileValue(profile.occupation)}
              />
              <DetailRow
                label="Employer"
                value={profileValue(profile.company_works_at)}
              />
              <DetailRow
                label="Birthday"
                value={dateLabel(profile.date_of_birth)}
              />
              <DetailRow
                label="Marital status"
                value={maritalLabel(profile.marital_status)}
              />
              <DetailRow
                label="Anniversary"
                value={dateLabel(profile.anniversary_date)}
              />
              <DetailRow
                label="Where they stay"
                value={residenceLabel(profile)}
              />
            </div>
          )}
        </section>,
            document.body,
          )
        : null}
    </div>
  );
}

function ProfileInput({
  label,
  onChange,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  type?: "date" | "text";
  value?: string | null;
}) {
  return (
    <label className="grid min-h-12 grid-cols-[112px_minmax(0,1fr)] items-center gap-3 border-b border-white/[0.07] py-2 text-[10px] font-medium tracking-[0.05em] text-[#969c99] uppercase">
      <span>{label}</span>
      <input
        className="h-9 min-w-0 rounded-md border border-[#383c3a] bg-[#0f100f] px-2.5 text-[12px] normal-case tracking-normal text-[#eceeed] outline-none placeholder:text-[#5f6461] focus:border-[#777f7b]"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value ?? ""}
      />
    </label>
  );
}
