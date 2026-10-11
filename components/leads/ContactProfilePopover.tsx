"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  Building2,
  Cake,
  Heart,
  Mail,
  MapPin,
  Pencil,
  Phone,
  UserRound,
  X,
} from "lucide-react";

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
  icon: Icon,
  label,
  value,
}: {
  icon: typeof UserRound;
  label: string;
  value: string;
}) {
  const isEmpty = value === "Not added";
  return (
    <div className="flex gap-3 border-b border-white/[0.07] py-3 last:border-b-0">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-[#a9afac]">
        <Icon aria-hidden className="size-3.5" strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-medium tracking-[0.08em] text-[#7f8582] uppercase">
          {label}
        </p>
        <p
          className={`mt-1 text-[12px] leading-5 [overflow-wrap:anywhere] ${isEmpty ? "text-[#777d79]" : "text-[#ecefed]"}`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

export function ContactProfilePopover({ name, profile, onSave }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState<ContactProfileWrite>({});

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
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

      {open ? (
        <section
          aria-label={`${name} contact profile`}
          className="absolute top-[62px] left-0 z-[110] w-[390px] max-w-[calc(100vw-48px)] rounded-xl border border-[#343735] bg-[#171817] shadow-[0_24px_70px_rgba(0,0,0,0.58)] before:absolute before:-top-[7px] before:left-[17px] before:size-3.5 before:rotate-45 before:border-t before:border-l before:border-[#343735] before:bg-[#171817] max-[560px]:left-[-10px] max-[560px]:w-[calc(100vw-44px)]"
          role="dialog"
        >
          <header className="flex items-start justify-between border-b border-white/[0.08] px-4 py-3.5">
            <div className="min-w-0 pr-3">
              <p className="text-[10px] font-medium tracking-[0.14em] text-[#858b88] uppercase">
                Contact profile
              </p>
              <h3 className="mt-1 truncate text-sm font-semibold text-[#f1f3f2]">
                {name}
              </h3>
              <p className="mt-0.5 truncate text-[11px] text-[#919794]">
                {profile.email || profile.phone_number || "Contact details unavailable"}
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
            <form onSubmit={save}>
              <div className="grid max-h-[58vh] grid-cols-2 gap-3 overflow-y-auto px-4 py-4 [scrollbar-color:#444_transparent] max-[430px]:grid-cols-1">
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
                <label className="flex min-w-0 flex-col gap-1.5 text-[10px] font-medium tracking-[0.05em] text-[#969c99] uppercase">
                  Marital status
                  <select
                    className="h-10 rounded-md border border-[#383c3a] bg-[#0f100f] px-3 text-[12px] normal-case tracking-normal text-[#eceeed] outline-none focus:border-[#777f7b]"
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
                <label className="col-span-2 flex min-w-0 flex-col gap-1.5 text-[10px] font-medium tracking-[0.05em] text-[#969c99] uppercase max-[430px]:col-span-1">
                  Home address
                  <textarea
                    className="min-h-20 resize-y rounded-md border border-[#383c3a] bg-[#0f100f] px-3 py-2.5 text-[12px] leading-5 normal-case tracking-normal text-[#eceeed] outline-none placeholder:text-[#5f6461] focus:border-[#777f7b]"
                    onChange={(event) => setField("address", event.target.value)}
                    placeholder="Apartment, street or locality"
                    value={form.address ?? ""}
                  />
                </label>
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
            <div className="grid max-h-[58vh] grid-cols-2 gap-x-5 overflow-y-auto px-4 py-1 [scrollbar-color:#444_transparent] max-[430px]:grid-cols-1">
              <DetailRow
                icon={Phone}
                label="Phone"
                value={profileValue(profile.phone_number)}
              />
              <DetailRow
                icon={Mail}
                label="Email"
                value={profileValue(profile.email)}
              />
              <DetailRow
                icon={BriefcaseBusiness}
                label="Occupation"
                value={profileValue(profile.occupation)}
              />
              <DetailRow
                icon={Building2}
                label="Employer"
                value={profileValue(profile.company_works_at)}
              />
              <DetailRow
                icon={Cake}
                label="Birthday"
                value={dateLabel(profile.date_of_birth)}
              />
              <DetailRow
                icon={Heart}
                label="Marital status"
                value={maritalLabel(profile.marital_status)}
              />
              <DetailRow
                icon={Heart}
                label="Anniversary"
                value={dateLabel(profile.anniversary_date)}
              />
              <DetailRow
                icon={MapPin}
                label="Where they stay"
                value={residenceLabel(profile)}
              />
            </div>
          )}
        </section>
      ) : null}
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
    <label className="flex min-w-0 flex-col gap-1.5 text-[10px] font-medium tracking-[0.05em] text-[#969c99] uppercase">
      {label}
      <input
        className="h-10 min-w-0 rounded-md border border-[#383c3a] bg-[#0f100f] px-3 text-[12px] normal-case tracking-normal text-[#eceeed] outline-none placeholder:text-[#5f6461] focus:border-[#777f7b]"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value ?? ""}
      />
    </label>
  );
}
