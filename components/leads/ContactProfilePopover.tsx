"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";
import { fetchWithSession } from "@/lib/clientAuth";

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
  country_code?: string | null;
  state_code?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
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
  | "country_code"
  | "state_code"
>;

type LocationOption = {
  iso_code?: string;
  name: string;
};

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
  const [countries, setCountries] = useState<LocationOption[]>([]);
  const [states, setStates] = useState<LocationOption[]>([]);
  const [cities, setCities] = useState<LocationOption[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const locationRequestRef = useRef(0);
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

  async function requestLocations(
    level: "countries" | "states" | "cities",
    countryCode?: string,
    stateCode?: string,
  ) {
    const search = new URLSearchParams({ level });
    if (countryCode) search.set("country", countryCode);
    if (stateCode) search.set("state", stateCode);
    const response = await fetchWithSession(`/api/locations?${search}`);
    if (!response.ok) throw new Error("Unable to load the location list");
    const body = (await response.json()) as { locations?: LocationOption[] };
    return body.locations ?? [];
  }

  function beginEditing() {
    setSaveError(null);
    setLocationNotice(null);
    const initialForm: ContactProfileWrite = {
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
      country_code: profile.country_code ?? "",
      state_code: profile.state_code ?? "",
    };
    setForm(initialForm);
    setEditing(true);
    void prepareLocationEditor(initialForm);
  }

  async function prepareLocationEditor(initialForm: ContactProfileWrite) {
    const requestId = ++locationRequestRef.current;
    setLocationLoading(true);
    try {
      const countryOptions = await requestLocations("countries");
      if (locationRequestRef.current !== requestId) return;
      setCountries(countryOptions);
      const country = countryOptions.find(
        (option) =>
          option.iso_code === initialForm.country_code ||
          option.name.toLocaleLowerCase("en") ===
            String(initialForm.country ?? "").toLocaleLowerCase("en"),
      );
      if (!country?.iso_code) {
        setStates([]);
        setCities([]);
        if (initialForm.country || initialForm.state || initialForm.city) {
          setLocationNotice(
            "The previous location was not verified. Select a country, state and city again.",
          );
        }
        setForm((current) => ({
          ...current,
          city: "",
          country: "",
          country_code: "",
          state: "",
          state_code: "",
        }));
        return;
      }

      const stateOptions = await requestLocations("states", country.iso_code);
      if (locationRequestRef.current !== requestId) return;
      setStates(stateOptions);
      const state = stateOptions.find(
        (option) =>
          option.iso_code === initialForm.state_code ||
          option.name.toLocaleLowerCase("en") ===
            String(initialForm.state ?? "").toLocaleLowerCase("en"),
      );
      const cityOptions =
        stateOptions.length > 0 && !state
          ? []
          : await requestLocations(
              "cities",
              country.iso_code,
              state?.iso_code,
            );
      if (locationRequestRef.current !== requestId) return;
      setCities(cityOptions);
      const city = cityOptions.find(
        (option) =>
          option.name.toLocaleLowerCase("en") ===
          String(initialForm.city ?? "").toLocaleLowerCase("en"),
      );
      if (
        (initialForm.state && stateOptions.length > 0 && !state) ||
        (initialForm.city && !city)
      ) {
        setLocationNotice(
          "Part of the previous location was not verified. Please confirm the missing selection.",
        );
      }
      setForm((current) => ({
        ...current,
        city: city?.name ?? "",
        country: country.name,
        country_code: country.iso_code,
        state: state?.name ?? "",
        state_code: state?.iso_code ?? "",
      }));
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : "Unable to load locations",
      );
    } finally {
      if (locationRequestRef.current === requestId) setLocationLoading(false);
    }
  }

  async function selectCountry(countryCode: string) {
    const country = countries.find((option) => option.iso_code === countryCode);
    const requestId = ++locationRequestRef.current;
    setLocationNotice(null);
    setStates([]);
    setCities([]);
    setForm((current) => ({
      ...current,
      city: "",
      country: country?.name ?? "",
      country_code: country?.iso_code ?? "",
      district: "",
      state: "",
      state_code: "",
    }));
    if (!country?.iso_code) {
      setLocationLoading(false);
      return;
    }
    setLocationLoading(true);
    try {
      const stateOptions = await requestLocations("states", country.iso_code);
      if (locationRequestRef.current !== requestId) return;
      setStates(stateOptions);
      if (stateOptions.length === 0) {
        const cityOptions = await requestLocations("cities", country.iso_code);
        if (locationRequestRef.current === requestId) setCities(cityOptions);
      }
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : "Unable to load locations",
      );
    } finally {
      if (locationRequestRef.current === requestId) setLocationLoading(false);
    }
  }

  async function selectState(stateCode: string) {
    const state = states.find((option) => option.iso_code === stateCode);
    const countryCode = String(form.country_code ?? "");
    const requestId = ++locationRequestRef.current;
    setLocationNotice(null);
    setCities([]);
    setForm((current) => ({
      ...current,
      city: "",
      district: "",
      state: state?.name ?? "",
      state_code: state?.iso_code ?? "",
    }));
    if (!countryCode || !state?.iso_code) {
      setLocationLoading(false);
      return;
    }
    setLocationLoading(true);
    try {
      const cityOptions = await requestLocations(
        "cities",
        countryCode,
        state.iso_code,
      );
      if (locationRequestRef.current === requestId) setCities(cityOptions);
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : "Unable to load locations",
      );
    } finally {
      if (locationRequestRef.current === requestId) setLocationLoading(false);
    }
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
        country_code: emptyToNull(String(form.country_code ?? "")),
        state_code: emptyToNull(String(form.state_code ?? "")),
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
                <p className="border-b border-white/[0.07] py-3 text-[11px] leading-5 text-[#858b88]">
                  Select a verified location for accurate dashboard mapping.
                  Street and locality text are not used as map coordinates.
                </p>
                {locationNotice ? (
                  <p className="mt-2 rounded-md border border-[#62542f] bg-[#241f12] px-3 py-2 text-[11px] leading-4 text-[#d7c27f]">
                    {locationNotice}
                  </p>
                ) : null}
                <ProfileSelect
                  disabled={locationLoading && countries.length === 0}
                  label="Country"
                  onChange={(value) => void selectCountry(value)}
                  options={countries}
                  placeholder={locationLoading ? "Loading countries…" : "Select country"}
                  value={String(form.country_code ?? "")}
                />
                {form.country_code && states.length > 0 ? (
                  <ProfileSelect
                    disabled={locationLoading}
                    label="State / province"
                    onChange={(value) => void selectState(value)}
                    options={states}
                    placeholder={locationLoading ? "Loading states…" : "Select state"}
                    value={String(form.state_code ?? "")}
                  />
                ) : null}
                {form.country_code &&
                (states.length === 0 || form.state_code) ? (
                  <ProfileSelect
                    disabled={locationLoading}
                    label="City"
                    onChange={(value) => setField("city", value)}
                    options={cities}
                    placeholder={locationLoading ? "Loading cities…" : "Select city"}
                    value={String(form.city ?? "")}
                    valueByName
                  />
                ) : null}
                <ProfileInput
                  label="District / locality"
                  onChange={(value) => setField("district", value)}
                  value={form.district}
                />
                <ProfileInput
                  label="PIN / postal code"
                  onChange={(value) => setField("postal_code", value)}
                  value={form.postal_code}
                />
                <ProfileInput
                  label="Street address"
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
                  disabled={saving || locationLoading}
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

function ProfileSelect({
  disabled = false,
  label,
  onChange,
  options,
  placeholder,
  value,
  valueByName = false,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  options: LocationOption[];
  placeholder: string;
  value: string;
  valueByName?: boolean;
}) {
  return (
    <label className="grid min-h-12 grid-cols-[112px_minmax(0,1fr)] items-center gap-3 border-b border-white/[0.07] py-2 text-[10px] font-medium tracking-[0.05em] text-[#969c99] uppercase">
      <span>{label}</span>
      <select
        className="h-9 min-w-0 rounded-md border border-[#383c3a] bg-[#0f100f] px-2.5 text-[12px] normal-case tracking-normal text-[#eceeed] outline-none focus:border-[#777f7b] disabled:cursor-wait disabled:opacity-55"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => {
          const optionValue = valueByName ? option.name : option.iso_code ?? option.name;
          return (
            <option key={`${option.iso_code ?? ""}:${option.name}`} value={optionValue}>
              {option.name}
            </option>
          );
        })}
      </select>
    </label>
  );
}
