"use client";

import {
  ArrowRight,
  Building2,
  FileSpreadsheet,
  Layers3,
  LoaderCircle,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";
import type {
  AssetType,
  FloorPlan,
  InventoryAttributeDefinition,
  InventoryDialogKind,
  InventoryNode,
  InventoryUnit,
  PriceBook,
  UnitType,
} from "./types";

const inputClass =
  "h-11 w-full rounded-lg border border-white/[0.11] bg-[#0b0e0c] px-3 text-sm text-white outline-none transition placeholder:text-[#606763] focus:border-[#57d6b1]/55 focus:ring-2 focus:ring-[#57d6b1]/10";
const labelClass = "mb-2 block text-xs font-medium text-[#aeb4b1]";

type DialogProps = {
  kind: InventoryDialogKind;
  projectId: number;
  unitTypes: UnitType[];
  nodes: InventoryNode[];
  assetTypes: AssetType[];
  floorPlans: FloorPlan[];
  attributes: InventoryAttributeDefinition[];
  editing?:
    InventoryUnit | UnitType | FloorPlan | InventoryNode | PriceBook | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

function isUnitType(item: DialogProps["editing"]): item is UnitType {
  return Boolean(item && "asset_type_id" in item);
}

function isInventoryNode(item: DialogProps["editing"]): item is InventoryNode {
  return Boolean(item && "parent_node_id" in item);
}

function isFloorPlan(item: DialogProps["editing"]): item is FloorPlan {
  return Boolean(item && "floor_plan_id" in item);
}

function isPriceBook(item: DialogProps["editing"]): item is PriceBook {
  return Boolean(item && "price_book_id" in item);
}

async function submitJson(
  url: string,
  body: Record<string, unknown>,
  method: "POST" | "PATCH" = "POST",
) {
  const response = await fetchWithSession(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await getApiError(response));
  return response.json();
}

function DialogShell({
  children,
  description,
  onClose,
  title,
}: {
  children: React.ReactNode;
  description: string;
  onClose: () => void;
  title: string;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="dialog"
    >
      <div className="max-h-[calc(100dvh-32px)] w-full max-w-[620px] overflow-y-auto rounded-2xl border border-white/[0.13] bg-[#111512] shadow-[0_30px_100px_rgba(0,0,0,.7)]">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-white/[0.09] bg-[#111512]/95 px-6 py-5 backdrop-blur-xl">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.02em] text-white">
              {title}
            </h2>
            <p className="mt-1 text-sm text-[#7f8783]">{description}</p>
          </div>
          <button
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-[#909793] transition hover:bg-white/[0.07] hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X className="size-[18px]" />
          </button>
        </div>
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
        className="h-10 rounded-lg border border-white/[0.12] px-4 text-sm font-medium text-[#bbc1be] transition hover:bg-white/[0.05] hover:text-white"
        onClick={onClose}
        type="button"
      >
        Cancel
      </button>
      <button
        className="flex h-10 min-w-28 items-center justify-center gap-2 rounded-lg bg-[#2b8d70] px-4 text-sm font-semibold text-white transition hover:bg-[#32a07f] disabled:cursor-not-allowed disabled:opacity-55"
        disabled={busy}
        type="submit"
      >
        {busy && <LoaderCircle className="size-4 animate-spin" />}
        {label}
      </button>
    </div>
  );
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function Field({
  children,
  label,
  wide = false,
}: {
  children: React.ReactNode;
  label: string;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "sm:col-span-2" : undefined}>
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

function customAttributePayload(
  definitions: InventoryAttributeDefinition[],
  values: Record<string, unknown>,
) {
  const payload = { ...values };
  for (const definition of definitions.filter((item) => item.is_active)) {
    const storedValue = values[definition.attribute_key];
    const value =
      definition.data_type === "boolean" && storedValue === undefined
        ? false
        : storedValue;
    const empty =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (definition.is_required && empty)
      throw new Error(`${definition.label} is required`);
    if (empty) {
      delete payload[definition.attribute_key];
      continue;
    }
    payload[definition.attribute_key] =
      definition.data_type === "number" ? Number(value) : value;
  }
  return payload;
}

function CustomAttributeFields({
  definitions,
  onChange,
  values,
}: {
  definitions: InventoryAttributeDefinition[];
  onChange: (values: Record<string, unknown>) => void;
  values: Record<string, unknown>;
}) {
  const visible = definitions.filter(
    (definition) =>
      definition.is_active || values[definition.attribute_key] !== undefined,
  );
  if (!visible.length) return null;

  function update(key: string, value: unknown) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="mt-6 border-t border-white/[0.08] pt-5">
      <div className="mb-4">
        <p className="text-sm font-medium text-[#dfe3e0]">Custom details</p>
        <p className="mt-1 text-xs text-[#6f7773]">
          Fields configured specifically for this project.
        </p>
      </div>
      <FormGrid>
        {visible.map((definition) => {
          const options = definition.options.map(String);
          const value = values[definition.attribute_key];
          if (definition.data_type === "boolean")
            return (
              <label
                className="flex min-h-11 items-center gap-2 self-end rounded-lg border border-white/[0.09] px-3 text-sm text-[#b5bbb8]"
                key={definition.definition_id}
              >
                <input
                  checked={value === true}
                  className="accent-[#45c39e]"
                  disabled={!definition.is_active}
                  onChange={(event) =>
                    update(definition.attribute_key, event.target.checked)
                  }
                  type="checkbox"
                />
                {definition.label}
                {definition.is_required && (
                  <span className="text-[#60d5b2]">*</span>
                )}
              </label>
            );
          if (definition.data_type === "multi_select") {
            const selected = Array.isArray(value) ? value.map(String) : [];
            return (
              <fieldset
                className="rounded-lg border border-white/[0.09] px-3 py-3 sm:col-span-2"
                disabled={!definition.is_active}
                key={definition.definition_id}
              >
                <legend className="px-1 text-xs font-medium text-[#aeb4b1]">
                  {definition.label}
                  {definition.is_required && (
                    <span className="ml-1 text-[#60d5b2]">*</span>
                  )}
                </legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {options.map((option) => (
                    <label
                      className="flex items-center gap-2 text-sm text-[#aeb4b1]"
                      key={option}
                    >
                      <input
                        checked={selected.includes(option)}
                        className="accent-[#45c39e]"
                        onChange={(event) =>
                          update(
                            definition.attribute_key,
                            event.target.checked
                              ? [...selected, option]
                              : selected.filter((item) => item !== option),
                          )
                        }
                        type="checkbox"
                      />
                      {option}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          }
          return (
            <Field
              key={definition.definition_id}
              label={`${definition.label}${definition.is_required ? " *" : ""}`}
            >
              {definition.data_type === "select" ? (
                <select
                  className={inputClass}
                  disabled={!definition.is_active}
                  onChange={(event) =>
                    update(definition.attribute_key, event.target.value)
                  }
                  required={definition.is_required}
                  value={String(value ?? "")}
                >
                  <option value="">Select</option>
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={inputClass}
                  disabled={!definition.is_active}
                  onChange={(event) =>
                    update(definition.attribute_key, event.target.value)
                  }
                  required={definition.is_required}
                  step={definition.data_type === "number" ? "any" : undefined}
                  type={definition.data_type}
                  value={String(value ?? "")}
                />
              )}
            </Field>
          );
        })}
      </FormGrid>
    </div>
  );
}

function AddUnitForm({
  attributes,
  editing,
  nodes,
  onClose,
  onSaved,
  projectId,
  unitTypes,
}: Pick<
  DialogProps,
  | "attributes"
  | "editing"
  | "nodes"
  | "onClose"
  | "onSaved"
  | "projectId"
  | "unitTypes"
>) {
  const unit = editing && "unit_id" in editing ? editing : null;
  const [busy, setBusy] = useState(false);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>(
    unit?.metadata ?? {},
  );
  const customDefinitions = attributes.filter(
    (attribute) => attribute.applies_to === "unit",
  );
  const [form, setForm] = useState({
    unit_code: unit?.unit_code ?? "",
    unit_name: unit?.unit_name ?? "",
    unit_type_id: unit?.unit_type_id ?? unitTypes[0]?.unit_type_id ?? "",
    node_id: unit?.node_id ?? "",
    orientation: unit?.orientation ?? "",
    area_sqft: unit?.area_sqft === null ? "" : String(unit?.area_sqft ?? ""),
    price_override:
      unit?.price_override === null ? "" : String(unit?.price_override ?? ""),
    currency: unit?.currency ?? "INR",
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        unit_code: form.unit_code,
        unit_name: form.unit_name || null,
        unit_type_id: form.unit_type_id,
        node_id: form.node_id || null,
        orientation: form.orientation || null,
        area_sqft: form.area_sqft ? Number(form.area_sqft) : null,
        price_override: form.price_override
          ? Number(form.price_override)
          : null,
        currency: form.currency,
        metadata: customAttributePayload(customDefinitions, customValues),
        ...(unit ? { version: unit.version } : {}),
      };
      await submitJson(
        unit ? `/api/inventory/units/${unit.unit_id}` : "/api/inventory/units",
        unit ? body : { project_id: projectId, ...body },
        unit ? "PATCH" : "POST",
      );
      toast.success(`Unit ${form.unit_code} ${unit ? "updated" : "created"}`);
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to add unit",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="p-6" onSubmit={submit}>
      <FormGrid>
        <Field label="Unit code">
          <input
            autoFocus
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                unit_code: event.target.value,
              }))
            }
            placeholder="A-1204"
            required
            value={form.unit_code}
          />
        </Field>
        <Field label="Display name">
          <input
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                unit_name: event.target.value,
              }))
            }
            placeholder="Tower A · 1204"
            value={form.unit_name}
          />
        </Field>
        <Field label="Unit type">
          <select
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                unit_type_id: event.target.value,
              }))
            }
            required
            value={form.unit_type_id}
          >
            <option value="">Select a unit type</option>
            {unitTypes.map((type) => (
              <option key={type.unit_type_id} value={type.unit_type_id}>
                {type.type_name} · {type.type_code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Structure location">
          <select
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                node_id: event.target.value,
              }))
            }
            value={form.node_id}
          >
            <option value="">No location</option>
            {nodes.map((node) => (
              <option key={node.node_id} value={node.node_id}>
                {"— ".repeat(node.depth)}
                {node.node_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Orientation">
          <input
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                orientation: event.target.value,
              }))
            }
            placeholder="East facing"
            value={form.orientation}
          />
        </Field>
        <Field label="Area (sq ft)">
          <input
            className={inputClass}
            min="0"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                area_sqft: event.target.value,
              }))
            }
            placeholder="1450"
            step="0.01"
            type="number"
            value={form.area_sqft}
          />
        </Field>
        <Field label="Override price">
          <input
            className={inputClass}
            min="0"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                price_override: event.target.value,
              }))
            }
            placeholder="Optional"
            step="0.01"
            type="number"
            value={form.price_override}
          />
        </Field>
        <Field label="Currency">
          <input
            className={inputClass}
            maxLength={3}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                currency: event.target.value.toUpperCase(),
              }))
            }
            value={form.currency}
          />
        </Field>
      </FormGrid>
      <CustomAttributeFields
        definitions={customDefinitions}
        onChange={setCustomValues}
        values={customValues}
      />
      <FormActions
        busy={busy}
        label={unit ? "Save changes" : "Add unit"}
        onClose={onClose}
      />
    </form>
  );
}

function AddUnitTypeForm({
  assetTypes,
  attributes,
  editing,
  floorPlans,
  onClose,
  onSaved,
  projectId,
}: Pick<
  DialogProps,
  | "assetTypes"
  | "attributes"
  | "editing"
  | "floorPlans"
  | "onClose"
  | "onSaved"
  | "projectId"
>) {
  const unitType = isUnitType(editing) ? editing : null;
  const [busy, setBusy] = useState(false);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>(
    unitType?.specifications ?? {},
  );
  const customDefinitions = attributes.filter(
    (attribute) => attribute.applies_to === "unit_type",
  );
  const [form, setForm] = useState({
    asset_type_id:
      unitType?.asset_type_id ?? assetTypes[0]?.asset_type_id ?? "",
    type_code: unitType?.type_code ?? "",
    type_name: unitType?.type_name ?? "",
    configuration: unitType?.configuration ?? "",
    bedrooms:
      unitType?.bedrooms === null ? "" : String(unitType?.bedrooms ?? ""),
    bathrooms:
      unitType?.bathrooms === null ? "" : String(unitType?.bathrooms ?? ""),
    balconies:
      unitType?.balconies === null ? "" : String(unitType?.balconies ?? ""),
    carpet_area_sqft:
      unitType?.carpet_area_sqft === null
        ? ""
        : String(unitType?.carpet_area_sqft ?? ""),
    saleable_area_sqft:
      unitType?.saleable_area_sqft === null
        ? ""
        : String(unitType?.saleable_area_sqft ?? ""),
    base_price:
      unitType?.base_price === null ? "" : String(unitType?.base_price ?? ""),
    currency: unitType?.currency ?? "INR",
    floor_plan_id: unitType?.floor_plans?.[0]?.floor_plan_id ?? "",
    is_active: unitType?.is_active ?? true,
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const numeric = (value: string) => (value ? Number(value) : null);
    try {
      const body = {
        asset_type_id: form.asset_type_id,
        type_code: form.type_code,
        type_name: form.type_name,
        configuration: form.configuration || null,
        bedrooms: numeric(form.bedrooms),
        bathrooms: numeric(form.bathrooms),
        balconies: numeric(form.balconies),
        carpet_area_sqft: numeric(form.carpet_area_sqft),
        saleable_area_sqft: numeric(form.saleable_area_sqft),
        base_price: numeric(form.base_price),
        currency: form.currency,
        floor_plan_id: form.floor_plan_id || null,
        specifications: customAttributePayload(customDefinitions, customValues),
        ...(unitType ? { is_active: form.is_active } : {}),
      };
      await submitJson(
        unitType
          ? `/api/inventory/unit-types/${unitType.unit_type_id}`
          : "/api/inventory/unit-types",
        unitType ? body : { project_id: projectId, ...body },
        unitType ? "PATCH" : "POST",
      );
      toast.success(`Unit type ${unitType ? "updated" : "created"}`);
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to add unit type",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="p-6" onSubmit={submit}>
      <FormGrid>
        <Field label="Asset type">
          <select
            autoFocus
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                asset_type_id: event.target.value,
              }))
            }
            required
            value={form.asset_type_id}
          >
            <option value="">Select asset type</option>
            {assetTypes.map((type) => (
              <option key={type.asset_type_id} value={type.asset_type_id}>
                {type.display_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type code">
          <input
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                type_code: event.target.value,
              }))
            }
            placeholder="3BHK-A"
            required
            value={form.type_code}
          />
        </Field>
        <Field label="Type name">
          <input
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                type_name: event.target.value,
              }))
            }
            placeholder="3 bedroom premium"
            required
            value={form.type_name}
          />
        </Field>
        <Field label="Configuration">
          <input
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                configuration: event.target.value,
              }))
            }
            placeholder="3 BHK"
            value={form.configuration}
          />
        </Field>
        {[
          ["bedrooms", "Bedrooms"],
          ["bathrooms", "Bathrooms"],
          ["balconies", "Balconies"],
          ["carpet_area_sqft", "Carpet area (sq ft)"],
          ["saleable_area_sqft", "Saleable area (sq ft)"],
          ["base_price", "Base price"],
        ].map(([key, label]) => (
          <Field key={key} label={label}>
            <input
              className={inputClass}
              min="0"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
              step={key.includes("area") || key === "base_price" ? "0.01" : "1"}
              type="number"
              value={String(form[key as keyof typeof form] ?? "")}
            />
          </Field>
        ))}
        <Field label="Primary floor plan">
          <select
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                floor_plan_id: event.target.value,
              }))
            }
            value={form.floor_plan_id}
          >
            <option value="">Add later</option>
            {floorPlans.map((plan) => (
              <option key={plan.floor_plan_id} value={plan.floor_plan_id}>
                {plan.plan_name} · v{plan.version}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Currency">
          <input
            className={inputClass}
            maxLength={3}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                currency: event.target.value.toUpperCase(),
              }))
            }
            value={form.currency}
          />
        </Field>
      </FormGrid>
      <CustomAttributeFields
        definitions={customDefinitions}
        onChange={setCustomValues}
        values={customValues}
      />
      {unitType && (
        <label className="mt-5 flex items-center gap-2 text-sm text-[#b5bbb8]">
          <input
            checked={form.is_active}
            className="accent-[#45c39e]"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                is_active: event.target.checked,
              }))
            }
            type="checkbox"
          />
          Active and available for new units
        </label>
      )}
      <FormActions
        busy={busy}
        label={unitType ? "Save changes" : "Create type"}
        onClose={onClose}
      />
    </form>
  );
}

function AddNodeForm({
  editing,
  nodes,
  onClose,
  onSaved,
  projectId,
}: Pick<
  DialogProps,
  "editing" | "nodes" | "onClose" | "onSaved" | "projectId"
>) {
  const inventoryNode = isInventoryNode(editing) ? editing : null;
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    parent_node_id: inventoryNode?.parent_node_id ?? "",
    node_kind: inventoryNode?.node_kind ?? "tower",
    node_code: inventoryNode?.node_code ?? "",
    node_name: inventoryNode?.node_name ?? "",
    sort_order: String(inventoryNode?.sort_order ?? 0),
    is_active: inventoryNode?.is_active ?? true,
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        parent_node_id: form.parent_node_id || null,
        node_kind: form.node_kind,
        node_code: form.node_code,
        node_name: form.node_name,
        sort_order: Number(form.sort_order),
        ...(inventoryNode ? { is_active: form.is_active } : {}),
      };
      await submitJson(
        inventoryNode
          ? `/api/inventory/nodes/${inventoryNode.node_id}`
          : "/api/inventory/nodes",
        inventoryNode ? body : { project_id: projectId, ...body },
        inventoryNode ? "PATCH" : "POST",
      );
      toast.success(`Structure item ${inventoryNode ? "updated" : "added"}`);
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to add structure",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="p-6" onSubmit={submit}>
      <FormGrid>
        <Field label="Parent location" wide>
          <select
            autoFocus
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                parent_node_id: event.target.value,
              }))
            }
            value={form.parent_node_id}
          >
            <option value="">Project root</option>
            {nodes
              .filter((node) => node.node_id !== inventoryNode?.node_id)
              .map((node) => (
                <option key={node.node_id} value={node.node_id}>
                  {"— ".repeat(node.depth)}
                  {node.node_name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Kind">
          <select
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                node_kind: event.target.value,
              }))
            }
            value={form.node_kind}
          >
            {[
              "phase",
              "tower",
              "building",
              "wing",
              "floor",
              "block",
              "cluster",
              "street",
              "zone",
              "other",
            ].map((kind) => (
              <option key={kind} value={kind}>
                {kind.charAt(0).toUpperCase() + kind.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Code">
          <input
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                node_code: event.target.value,
              }))
            }
            placeholder="TOWER-A"
            required
            value={form.node_code}
          />
        </Field>
        <Field label="Name" wide>
          <input
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                node_name: event.target.value,
              }))
            }
            placeholder="Tower A"
            required
            value={form.node_name}
          />
        </Field>
        <Field label="Sort order">
          <input
            className={inputClass}
            min="0"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                sort_order: event.target.value,
              }))
            }
            type="number"
            value={form.sort_order}
          />
        </Field>
      </FormGrid>
      {inventoryNode && (
        <label className="mt-5 flex items-center gap-2 text-sm text-[#b5bbb8]">
          <input
            checked={form.is_active}
            className="accent-[#45c39e]"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                is_active: event.target.checked,
              }))
            }
            type="checkbox"
          />
          Active structure item
        </label>
      )}
      <FormActions
        busy={busy}
        label={inventoryNode ? "Save changes" : "Add location"}
        onClose={onClose}
      />
    </form>
  );
}

function AddFloorPlanForm({
  editing,
  onClose,
  onSaved,
  projectId,
}: Pick<DialogProps, "editing" | "onClose" | "onSaved" | "projectId">) {
  const floorPlan = isFloorPlan(editing) ? editing : null;
  const [busy, setBusy] = useState(false);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [existingAssets, setExistingAssets] = useState(floorPlan?.assets ?? []);
  const [form, setForm] = useState({
    plan_code: floorPlan?.plan_code ?? "",
    plan_name: floorPlan?.plan_name ?? "",
    version: String(floorPlan?.version ?? 1),
    description: floorPlan?.description ?? "",
    asset_url: "",
    is_active: floorPlan?.is_active ?? true,
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        plan_code: form.plan_code,
        plan_name: form.plan_name,
        description: form.description || null,
        ...(floorPlan ? { is_active: form.is_active } : {}),
      };
      if (floorPlan) {
        await submitJson(
          `/api/inventory/floor-plans/${floorPlan.floor_plan_id}`,
          body,
          "PATCH",
        );
        if (form.asset_url) {
          await submitJson(
            `/api/inventory/floor-plans/${floorPlan.floor_plan_id}/assets`,
            {
              asset_kind: "plan",
              asset_url: form.asset_url,
              display_order: floorPlan.assets.length + 1,
            },
          );
        }
      } else {
        await submitJson("/api/inventory/floor-plans", {
          project_id: projectId,
          version: Number(form.version),
          ...body,
          assets: form.asset_url
            ? [
                {
                  asset_kind: "plan",
                  asset_url: form.asset_url,
                  display_order: 1,
                },
              ]
            : [],
        });
      }
      toast.success(`Floor plan ${floorPlan ? "updated" : "created"}`);
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to add floor plan",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeAsset(assetId: string) {
    if (!floorPlan) return;
    setDeletingAssetId(assetId);
    try {
      const response = await fetchWithSession(
        `/api/inventory/floor-plans/${floorPlan.floor_plan_id}/assets/${assetId}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(await getApiError(response));
      setExistingAssets((current) =>
        current.filter((asset) => asset.asset_id !== assetId),
      );
      toast.success("Floor plan file removed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to remove plan file",
      );
    } finally {
      setDeletingAssetId(null);
    }
  }

  return (
    <form className="p-6" onSubmit={submit}>
      <FormGrid>
        <Field label="Plan code">
          <input
            autoFocus
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                plan_code: event.target.value,
              }))
            }
            placeholder="FP-3BHK-A"
            required
            value={form.plan_code}
          />
        </Field>
        <Field label="Plan name">
          <input
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                plan_name: event.target.value,
              }))
            }
            placeholder="3 BHK Type A"
            required
            value={form.plan_name}
          />
        </Field>
        <Field label="Version">
          <input
            className={inputClass}
            disabled={Boolean(floorPlan)}
            min="1"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                version: event.target.value,
              }))
            }
            required
            type="number"
            value={form.version}
          />
        </Field>
        <Field label={floorPlan ? "Add another plan URL" : "Plan URL"}>
          <input
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                asset_url: event.target.value,
              }))
            }
            placeholder="https://…"
            type="url"
            value={form.asset_url}
          />
        </Field>
        <Field label="Description" wide>
          <textarea
            className={`${inputClass} min-h-24 resize-y py-3`}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            placeholder="Internal description or revision note"
            value={form.description}
          />
        </Field>
      </FormGrid>
      {floorPlan && existingAssets.length > 0 && (
        <div className="mt-5 border-t border-white/[0.08] pt-5">
          <p className="mb-2 text-xs font-medium text-[#aeb4b1]">
            Attached plan files
          </p>
          <div className="divide-y divide-white/[0.07] rounded-lg border border-white/[0.08] px-3">
            {existingAssets.map((asset) => (
              <div
                className="flex items-center gap-3 py-2.5"
                key={asset.asset_id ?? asset.asset_url}
              >
                <FileSpreadsheet className="size-4 shrink-0 text-[#76807b]" />
                <a
                  className="min-w-0 flex-1 truncate text-xs text-[#b9c0bc] hover:text-white hover:underline"
                  href={asset.asset_url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {asset.file_name || asset.asset_url}
                </a>
                {asset.asset_id && (
                  <button
                    aria-label="Remove floor plan file"
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-[#7d8581] hover:bg-[#ff665a]/10 hover:text-[#ff8f86] disabled:opacity-40"
                    disabled={deletingAssetId === asset.asset_id}
                    onClick={() => void removeAsset(asset.asset_id!)}
                    type="button"
                  >
                    {deletingAssetId === asset.asset_id ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {floorPlan && (
        <label className="mt-5 flex items-center gap-2 text-sm text-[#b5bbb8]">
          <input
            checked={form.is_active}
            className="accent-[#45c39e]"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                is_active: event.target.checked,
              }))
            }
            type="checkbox"
          />
          Active floor plan
        </label>
      )}
      <FormActions
        busy={busy}
        label={floorPlan ? "Save changes" : "Create plan"}
        onClose={onClose}
      />
    </form>
  );
}

type GeneratorStack = {
  stack_code: string;
  unit_type_id: string;
};

function GenerateForm({
  nodes,
  onClose,
  onSaved,
  projectId,
  unitTypes,
}: Pick<
  DialogProps,
  "nodes" | "onClose" | "onSaved" | "projectId" | "unitTypes"
>) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"stacked" | "series">("stacked");
  const [common, setCommon] = useState({
    parent_node_id: "",
    unit_code_prefix: "",
    number_padding: "2",
    start_number: "1",
  });
  const [series, setSeries] = useState({
    quantity: "10",
    unit_type_id: unitTypes[0]?.unit_type_id ?? "",
  });
  const [stacked, setStacked] = useState({
    building_code: "",
    building_name: "",
    building_kind: "tower",
    level_kind: "floor",
    level_code_prefix: "F",
    level_count: "10",
    level_start: "1",
  });
  const [stacks, setStacks] = useState<GeneratorStack[]>([
    { stack_code: "01", unit_type_id: unitTypes[0]?.unit_type_id ?? "" },
  ]);

  const total =
    mode === "series"
      ? Number(series.quantity || 0)
      : Number(stacked.level_count || 0) * stacks.length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const body =
      mode === "series"
        ? {
            project_id: projectId,
            mode,
            parent_node_id: common.parent_node_id || null,
            unit_code_prefix: common.unit_code_prefix,
            number_padding: Number(common.number_padding),
            start_number: Number(common.start_number),
            quantity: Number(series.quantity),
            unit_type_id: series.unit_type_id,
          }
        : {
            project_id: projectId,
            mode,
            parent_node_id: common.parent_node_id || null,
            unit_code_prefix: common.unit_code_prefix,
            number_padding: Number(common.number_padding),
            start_number: Number(common.start_number),
            building_code: stacked.building_code,
            building_name: stacked.building_name,
            building_kind: stacked.building_kind,
            level_kind: stacked.level_kind,
            level_code_prefix: stacked.level_code_prefix,
            level_count: Number(stacked.level_count),
            level_start: Number(stacked.level_start),
            stacks,
          };
    try {
      await submitJson("/api/inventory/generate", body);
      toast.success(`${total.toLocaleString()} units generated`);
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to generate units",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="p-6" onSubmit={submit}>
      <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-black/20 p-1">
        {(
          [
            ["stacked", "Tower / building", Building2],
            ["series", "Simple series", Layers3],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            className={`flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium transition ${
              mode === value
                ? "bg-white/[0.1] text-white shadow-sm"
                : "text-[#8b938f] hover:text-white"
            }`}
            key={value}
            onClick={() => setMode(value)}
            type="button"
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      <FormGrid>
        <Field label="Place inside" wide>
          <select
            className={inputClass}
            onChange={(event) =>
              setCommon((current) => ({
                ...current,
                parent_node_id: event.target.value,
              }))
            }
            value={common.parent_node_id}
          >
            <option value="">Project root</option>
            {nodes.map((node) => (
              <option key={node.node_id} value={node.node_id}>
                {"— ".repeat(node.depth)}
                {node.node_name}
              </option>
            ))}
          </select>
        </Field>

        {mode === "stacked" ? (
          <>
            <Field label="Building code">
              <input
                autoFocus
                className={inputClass}
                onChange={(event) =>
                  setStacked((current) => ({
                    ...current,
                    building_code: event.target.value,
                  }))
                }
                placeholder="TOWER-A"
                required
                value={stacked.building_code}
              />
            </Field>
            <Field label="Building name">
              <input
                className={inputClass}
                onChange={(event) =>
                  setStacked((current) => ({
                    ...current,
                    building_name: event.target.value,
                  }))
                }
                placeholder="Tower A"
                required
                value={stacked.building_name}
              />
            </Field>
            <Field label="Number of floors">
              <input
                className={inputClass}
                max="5000"
                min="1"
                onChange={(event) =>
                  setStacked((current) => ({
                    ...current,
                    level_count: event.target.value,
                  }))
                }
                required
                type="number"
                value={stacked.level_count}
              />
            </Field>
            <Field label="First floor number">
              <input
                className={inputClass}
                min="0"
                onChange={(event) =>
                  setStacked((current) => ({
                    ...current,
                    level_start: event.target.value,
                  }))
                }
                required
                type="number"
                value={stacked.level_start}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Unit type">
              <select
                autoFocus
                className={inputClass}
                onChange={(event) =>
                  setSeries((current) => ({
                    ...current,
                    unit_type_id: event.target.value,
                  }))
                }
                required
                value={series.unit_type_id}
              >
                <option value="">Select unit type</option>
                {unitTypes.map((type) => (
                  <option key={type.unit_type_id} value={type.unit_type_id}>
                    {type.type_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantity">
              <input
                className={inputClass}
                max="5000"
                min="1"
                onChange={(event) =>
                  setSeries((current) => ({
                    ...current,
                    quantity: event.target.value,
                  }))
                }
                required
                type="number"
                value={series.quantity}
              />
            </Field>
          </>
        )}

        <Field label="Unit code prefix">
          <input
            className={inputClass}
            onChange={(event) =>
              setCommon((current) => ({
                ...current,
                unit_code_prefix: event.target.value,
              }))
            }
            placeholder={mode === "stacked" ? "A-" : "VILLA-"}
            required
            value={common.unit_code_prefix}
          />
        </Field>
        <Field label="Number padding">
          <input
            className={inputClass}
            min="1"
            onChange={(event) =>
              setCommon((current) => ({
                ...current,
                number_padding: event.target.value,
              }))
            }
            required
            type="number"
            value={common.number_padding}
          />
        </Field>
      </FormGrid>

      {mode === "stacked" && (
        <div className="mt-5 border-t border-white/[0.08] pt-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Unit stacks</p>
              <p className="mt-0.5 text-xs text-[#747c78]">
                One unit is created per stack on every floor.
              </p>
            </div>
            <button
              className="flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.11] px-3 text-xs font-medium text-[#c6cbc9] hover:bg-white/[0.05]"
              onClick={() =>
                setStacks((current) => [
                  ...current,
                  {
                    stack_code: String(current.length + 1).padStart(2, "0"),
                    unit_type_id: unitTypes[0]?.unit_type_id ?? "",
                  },
                ])
              }
              type="button"
            >
              <Plus className="size-3.5" /> Add stack
            </button>
          </div>
          <div className="space-y-2">
            {stacks.map((stack, index) => (
              <div
                className="grid grid-cols-[100px_minmax(0,1fr)_36px] gap-2"
                key={index}
              >
                <input
                  aria-label={`Stack ${index + 1} code`}
                  className={inputClass}
                  onChange={(event) =>
                    setStacks((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, stack_code: event.target.value }
                          : item,
                      ),
                    )
                  }
                  placeholder="01"
                  required
                  value={stack.stack_code}
                />
                <select
                  aria-label={`Stack ${index + 1} unit type`}
                  className={inputClass}
                  onChange={(event) =>
                    setStacks((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, unit_type_id: event.target.value }
                          : item,
                      ),
                    )
                  }
                  required
                  value={stack.unit_type_id}
                >
                  <option value="">Select type</option>
                  {unitTypes.map((type) => (
                    <option key={type.unit_type_id} value={type.unit_type_id}>
                      {type.type_name}
                    </option>
                  ))}
                </select>
                <button
                  aria-label={`Remove stack ${index + 1}`}
                  className="grid size-9 place-items-center self-center rounded-lg text-[#747c78] hover:bg-[#ff665a]/10 hover:text-[#ff8076] disabled:opacity-30"
                  disabled={stacks.length === 1}
                  onClick={() =>
                    setStacks((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  type="button"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between rounded-xl border border-[#57d6b1]/20 bg-[#57d6b1]/[0.06] px-4 py-3">
        <span className="text-sm text-[#aeb6b2]">Ready to generate</span>
        <span className="text-sm font-semibold text-[#79e5c5]">
          {Number.isFinite(total) ? total.toLocaleString() : 0} units
        </span>
      </div>
      <FormActions busy={busy} label="Generate units" onClose={onClose} />
    </form>
  );
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) =>
    header.toLowerCase().trim().replace(/\s+/g, "_"),
  );
  return rows
    .slice(1)
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      ),
    );
}

function ImportForm({
  onClose,
  onSaved,
  projectId,
}: Pick<DialogProps, "onClose" | "onSaved" | "projectId">) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [upsert, setUpsert] = useState(false);
  const [parseError, setParseError] = useState("");
  const headers = useMemo(() => Object.keys(rows[0] ?? {}), [rows]);

  async function chooseFile(nextFile: File | null) {
    setFile(nextFile);
    setRows([]);
    setParseError("");
    if (!nextFile) return;
    if (!nextFile.name.toLowerCase().endsWith(".csv")) {
      setParseError("Please choose a CSV file.");
      return;
    }
    const parsed = parseCsv(await nextFile.text());
    if (!parsed.length) {
      setParseError(
        "The CSV needs a header row and at least one inventory row.",
      );
      return;
    }
    if (!Object.hasOwn(parsed[0], "unit_code")) {
      setParseError("The CSV must include a unit_code column.");
      return;
    }
    if (
      !Object.hasOwn(parsed[0], "unit_type_code") &&
      !Object.hasOwn(parsed[0], "unit_type_id")
    ) {
      setParseError("Add either unit_type_code or unit_type_id to the CSV.");
      return;
    }
    if (parsed.length > 5000) {
      setParseError("A single import can contain at most 5,000 units.");
      return;
    }
    setRows(parsed);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !rows.length) return;
    setBusy(true);
    const normalizedRows = rows.map((row) => ({
      ...row,
      area_sqft: row.area_sqft ? Number(row.area_sqft) : null,
      price_override: row.price_override ? Number(row.price_override) : null,
      metadata: {},
    }));
    try {
      const result = await submitJson("/api/inventory/imports", {
        project_id: projectId,
        source: "csv",
        file_name: file.name,
        idempotency_key: `${file.name}-${file.size}-${file.lastModified}`,
        upsert,
        rows: normalizedRows,
        mapping: Object.fromEntries(headers.map((header) => [header, header])),
      });
      const job = result.import as {
        succeeded_rows?: number;
        failed_rows?: number;
      };
      toast.success(
        `${job.succeeded_rows ?? rows.length} units imported${job.failed_rows ? ` · ${job.failed_rows} failed` : ""}`,
      );
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to import inventory",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="p-6" onSubmit={submit}>
      <label className="grid min-h-40 cursor-pointer place-items-center rounded-xl border border-dashed border-white/[0.16] bg-black/10 px-6 text-center transition hover:border-[#57d6b1]/45 hover:bg-[#57d6b1]/[0.025]">
        <input
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
          type="file"
        />
        <span>
          <span className="mx-auto mb-3 grid size-10 place-items-center rounded-xl bg-white/[0.06] text-[#aeb5b2]">
            <Upload className="size-[18px]" />
          </span>
          <span className="block text-sm font-medium text-white">
            {file?.name ?? "Choose an inventory CSV"}
          </span>
          <span className="mt-1.5 block text-xs leading-5 text-[#737b77]">
            unit_code and unit_type_code are required. Up to 5,000 rows.
          </span>
        </span>
      </label>

      {parseError && (
        <p className="mt-3 rounded-lg border border-[#ff6b61]/20 bg-[#ff6b61]/[0.06] px-3 py-2 text-sm text-[#ff9a92]">
          {parseError}
        </p>
      )}

      {rows.length > 0 && (
        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-white">
              {rows.length.toLocaleString()} rows ready
            </p>
            <label className="flex items-center gap-2 text-xs text-[#a5aca9]">
              <input
                checked={upsert}
                className="accent-[#45c39e]"
                onChange={(event) => setUpsert(event.target.checked)}
                type="checkbox"
              />
              Update matching units
            </label>
          </div>
          <div className="overflow-x-auto rounded-lg border border-white/[0.09]">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="bg-white/[0.035] text-[#7f8783]">
                <tr>
                  {headers.slice(0, 5).map((header) => (
                    <th className="px-3 py-2.5 font-medium" key={header}>
                      {header.replaceAll("_", " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-[#c1c7c4]">
                {rows.slice(0, 5).map((row, index) => (
                  <tr key={index}>
                    {headers.slice(0, 5).map((header) => (
                      <td
                        className="max-w-36 truncate px-3 py-2.5"
                        key={header}
                      >
                        {row[header] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 5 && (
            <p className="mt-2 text-xs text-[#68706c]">
              Previewing 5 of {rows.length.toLocaleString()} rows
            </p>
          )}
        </div>
      )}

      <FormActions busy={busy} label="Import inventory" onClose={onClose} />
    </form>
  );
}

function AddPriceBookForm({
  editing,
  onClose,
  onSaved,
  projectId,
}: Pick<DialogProps, "editing" | "onClose" | "onSaved" | "projectId">) {
  const priceBook = isPriceBook(editing) ? editing : null;
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    price_book_code: priceBook?.price_book_code ?? "",
    price_book_name: priceBook?.price_book_name ?? "",
    currency: priceBook?.currency ?? "INR",
    valid_from: priceBook?.valid_from?.slice(0, 10) ?? "",
    valid_until: priceBook?.valid_until?.slice(0, 10) ?? "",
    is_default: priceBook?.is_default ?? true,
    is_active: priceBook?.is_active ?? true,
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        price_book_code: form.price_book_code,
        price_book_name: form.price_book_name,
        currency: form.currency,
        valid_from: form.valid_from || null,
        valid_until: form.valid_until || null,
        is_default: form.is_default,
        ...(priceBook ? { is_active: form.is_active } : {}),
      };
      await submitJson(
        priceBook
          ? `/api/inventory/price-books/${priceBook.price_book_id}`
          : "/api/inventory/price-books",
        priceBook ? body : { project_id: projectId, ...body },
        priceBook ? "PATCH" : "POST",
      );
      toast.success(`Price book ${priceBook ? "updated" : "created"}`);
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to create price book",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="p-6" onSubmit={submit}>
      <FormGrid>
        <Field label="Book code">
          <input
            autoFocus
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                price_book_code: event.target.value,
              }))
            }
            placeholder="FY27-LAUNCH"
            required
            value={form.price_book_code}
          />
        </Field>
        <Field label="Price book name">
          <input
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                price_book_name: event.target.value,
              }))
            }
            placeholder="Launch pricing"
            required
            value={form.price_book_name}
          />
        </Field>
        <Field label="Valid from">
          <input
            className={inputClass}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                valid_from: event.target.value,
              }))
            }
            type="date"
            value={form.valid_from}
          />
        </Field>
        <Field label="Valid until">
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
        </Field>
        <Field label="Currency">
          <input
            className={inputClass}
            maxLength={3}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                currency: event.target.value.toUpperCase(),
              }))
            }
            value={form.currency}
          />
        </Field>
        <label className="flex items-end pb-3">
          <span className="flex items-center gap-2 text-sm text-[#b5bbb8]">
            <input
              checked={form.is_default}
              className="accent-[#45c39e]"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  is_default: event.target.checked,
                }))
              }
              type="checkbox"
            />
            Set as default price book
          </span>
        </label>
        {priceBook && (
          <label className="flex items-end pb-3">
            <span className="flex items-center gap-2 text-sm text-[#b5bbb8]">
              <input
                checked={form.is_active}
                className="accent-[#45c39e]"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    is_active: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              Active price book
            </span>
          </label>
        )}
      </FormGrid>
      <FormActions
        busy={busy}
        label={priceBook ? "Save changes" : "Create book"}
        onClose={onClose}
      />
    </form>
  );
}

const dialogCopy: Record<
  InventoryDialogKind,
  { title: string; description: string }
> = {
  unit: {
    title: "Add inventory unit",
    description: "Create one individually managed property or sellable unit.",
  },
  unitType: {
    title: "Create unit type",
    description: "Define a reusable configuration, area and base price.",
  },
  floorPlan: {
    title: "Add floor plan",
    description: "Store one reusable plan and its current revision.",
  },
  node: {
    title: "Add structure",
    description: "Model a phase, tower, floor, cluster or custom location.",
  },
  generate: {
    title: "Generate inventory",
    description:
      "Create a numbered series or an entire tower in one operation.",
  },
  import: {
    title: "Import CSV",
    description: "Bring existing inventory into the selected project.",
  },
  priceBook: {
    title: "Create price book",
    description:
      "Organize project pricing by launch, channel or validity period.",
  },
};

export function InventoryDialog(props: DialogProps) {
  const copy = props.editing
    ? {
        title: `Edit ${
          props.kind === "unitType"
            ? "unit type"
            : props.kind === "floorPlan"
              ? "floor plan"
              : props.kind === "priceBook"
                ? "price book"
                : props.kind === "node"
                  ? "structure"
                  : "inventory unit"
        }`,
        description: "Update the saved inventory details.",
      }
    : dialogCopy[props.kind];
  return (
    <DialogShell
      description={copy.description}
      onClose={props.onClose}
      title={copy.title}
    >
      {props.kind === "unit" && <AddUnitForm {...props} />}
      {props.kind === "unitType" && <AddUnitTypeForm {...props} />}
      {props.kind === "floorPlan" && <AddFloorPlanForm {...props} />}
      {props.kind === "node" && <AddNodeForm {...props} />}
      {props.kind === "generate" && <GenerateForm {...props} />}
      {props.kind === "import" && <ImportForm {...props} />}
      {props.kind === "priceBook" && <AddPriceBookForm {...props} />}
    </DialogShell>
  );
}

export function ImportTemplateHint() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
      <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-[#75dcbc]" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#d9dddb]">CSV column format</p>
        <p className="mt-1 text-xs leading-5 text-[#79817d]">
          Required: unit_code, unit_type_code. Optional: node_code, unit_name,
          external_unit_key, orientation, area_sqft, price_override, currency,
          status.
        </p>
      </div>
      <ArrowRight className="mt-1 size-4 shrink-0 text-[#59605d]" />
    </div>
  );
}
