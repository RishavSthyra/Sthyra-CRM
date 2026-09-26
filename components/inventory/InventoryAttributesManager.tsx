"use client";

import {
  Braces,
  CheckSquare2,
  Hash,
  ListChecks,
  LoaderCircle,
  Pencil,
  Plus,
  TextCursorInput,
  ToggleLeft,
  X,
} from "lucide-react";

import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";
import type { InventoryAttributeDefinition } from "./types";

const inputClass =
  "h-11 w-full rounded-lg border border-white/[0.11] bg-[#0b0e0c] px-3 text-sm text-white outline-none transition placeholder:text-[#59605d] focus:border-[#57d6b1]/55 focus:ring-2 focus:ring-[#57d6b1]/10 disabled:cursor-not-allowed disabled:opacity-50";

const dataTypes: Array<{
  value: InventoryAttributeDefinition["data_type"];
  label: string;
}> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / No" },
  { value: "date", label: "Date" },
  { value: "select", label: "Single choice" },
  { value: "multi_select", label: "Multiple choices" },
];

function typeIcon(type: InventoryAttributeDefinition["data_type"]) {
  if (type === "number") return Hash;
  if (type === "boolean") return ToggleLeft;
  if (type === "select") return ListChecks;
  if (type === "multi_select") return CheckSquare2;
  if (type === "date") return Braces;
  return TextCursorInput;
}

async function saveJson(
  url: string,
  body: Record<string, unknown>,
  method: "POST" | "PATCH",
) {
  const response = await fetchWithSession(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await getApiError(response));
  return response.json();
}

function AttributeDialog({
  editing,
  onClose,
  onSaved,
  projectId,
}: {
  editing: InventoryAttributeDefinition | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  projectId: number;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    applies_to: editing?.applies_to ?? ("unit_type" as "unit_type" | "unit"),
    label: editing?.label ?? "",
    attribute_key: editing?.attribute_key ?? "",
    data_type:
      editing?.data_type ??
      ("text" as InventoryAttributeDefinition["data_type"]),
    options: (editing?.options ?? []).map(String).join("\n"),
    display_order: String(editing?.display_order ?? 0),
    is_required: editing?.is_required ?? false,
    is_active: editing?.is_active ?? true,
  });
  const needsOptions = ["select", "multi_select"].includes(form.data_type);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        ...(!editing
          ? { project_id: projectId, applies_to: form.applies_to }
          : {}),
        label: form.label,
        attribute_key: form.attribute_key || undefined,
        data_type: form.data_type,
        options: needsOptions
          ? form.options
              .split(/\r?\n|,/)
              .map((option) => option.trim())
              .filter(Boolean)
          : [],
        display_order: Number(form.display_order),
        is_required: form.is_required,
        ...(editing ? { is_active: form.is_active } : {}),
      };
      await saveJson(
        editing
          ? `/api/inventory/attributes/${editing.definition_id}`
          : "/api/inventory/attributes",
        body,
        editing ? "PATCH" : "POST",
      );
      toast.success(editing ? "Custom field updated" : "Custom field created");
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save custom field",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="dialog"
    >
      <div className="max-h-[calc(100dvh-32px)] w-full max-w-[580px] overflow-y-auto rounded-2xl border border-white/[0.13] bg-[#111512] shadow-[0_30px_100px_rgba(0,0,0,.7)]">
        <div className="flex items-start justify-between border-b border-white/[0.09] px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {editing ? "Edit custom field" : "Add custom field"}
            </h2>
            <p className="mt-1 text-sm text-[#7f8783]">
              Add a project-specific field without changing the database schema.
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
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                Used on
              </span>
              <select
                className={inputClass}
                disabled={Boolean(editing)}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    applies_to: event.target.value as "unit_type" | "unit",
                  }))
                }
                value={form.applies_to}
              >
                <option value="unit_type">Unit types</option>
                <option value="unit">Individual units</option>
              </select>
            </label>
            <label>
              <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                Field type
              </span>
              <select
                className={inputClass}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    data_type: event.target
                      .value as InventoryAttributeDefinition["data_type"],
                  }))
                }
                value={form.data_type}
              >
                {dataTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                Label
              </span>
              <input
                autoFocus
                className={inputClass}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    label: event.target.value,
                  }))
                }
                placeholder="Garden area"
                required
                value={form.label}
              />
            </label>
            <label>
              <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                Field key
              </span>
              <input
                className={inputClass}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    attribute_key: event.target.value,
                  }))
                }
                placeholder="Generated from label"
                value={form.attribute_key}
              />
            </label>
            {needsOptions && (
              <label className="sm:col-span-2">
                <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                  Options
                </span>
                <textarea
                  className={`${inputClass} min-h-28 resize-y py-3`}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      options: event.target.value,
                    }))
                  }
                  placeholder={"Garden facing\nPool facing\nCity view"}
                  required
                  value={form.options}
                />
                <span className="mt-1.5 block text-[11px] text-[#68706c]">
                  Enter one option per line.
                </span>
              </label>
            )}
            <label>
              <span className="mb-2 block text-xs font-medium text-[#aeb4b1]">
                Display order
              </span>
              <input
                className={inputClass}
                min="0"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    display_order: event.target.value,
                  }))
                }
                type="number"
                value={form.display_order}
              />
            </label>
            <div className="flex flex-col justify-end gap-3 pb-2">
              <label className="flex items-center gap-2 text-sm text-[#b5bbb8]">
                <input
                  checked={form.is_required}
                  className="accent-[#45c39e]"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      is_required: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                Required field
              </label>
              {editing && (
                <label className="flex items-center gap-2 text-sm text-[#b5bbb8]">
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
                  Active field
                </label>
              )}
            </div>
          </div>

          <div className="mt-7 flex justify-end gap-2 border-t border-white/[0.08] pt-5">
            <button
              className="h-10 rounded-lg border border-white/[0.12] px-4 text-sm text-[#bbc1be] hover:bg-white/[0.05]"
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
              {editing ? "Save field" : "Add field"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function InventoryAttributesManager({
  attributes,
  onChanged,
  projectId,
}: {
  attributes: InventoryAttributeDefinition[];
  onChanged: () => Promise<void>;
  projectId: number;
}) {
  const [editing, setEditing] = useState<
    InventoryAttributeDefinition | "new" | null
  >(null);

  return (
    <div className="mt-3 border-t border-white/[0.08] pt-7 xl:col-span-2">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[#e8ebe9]">
            Custom fields
          </h2>
          <p className="mt-1 text-sm text-[#747c78]">
            Capture project-specific details for unit types or individual units.
          </p>
        </div>
        <button
          className="flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.11] px-3 text-xs font-semibold text-[#c3c8c5] hover:bg-white/[0.05]"
          onClick={() => setEditing("new")}
          type="button"
        >
          <Plus className="size-3.5" /> Add custom field
        </button>
      </div>

      {attributes.length ? (
        <div className="mt-5 grid gap-x-10 gap-y-7 md:grid-cols-2">
          {(["unit_type", "unit"] as const).map((scope) => {
            const scoped = attributes.filter(
              (attribute) => attribute.applies_to === scope,
            );
            return (
              <div key={scope}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <p className="text-[10px] font-semibold tracking-[0.12em] text-[#656d69] uppercase">
                    {scope === "unit_type" ? "Unit type fields" : "Unit fields"}
                  </p>
                  <span className="text-[10px] text-[#59615d]">
                    {scoped.length}
                  </span>
                </div>
                {scoped.length ? (
                  <div className="divide-y divide-white/[0.07] border-y border-white/[0.08]">
                    {scoped.map((attribute) => {
                      const Icon = typeIcon(attribute.data_type);
                      return (
                        <div
                          className="flex items-center gap-3 py-3.5"
                          key={attribute.definition_id}
                        >
                          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.04] text-[#7d8581]">
                            <Icon className="size-3.5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-[#d9ddda]">
                              {attribute.label}
                              {attribute.is_required && (
                                <span className="ml-1 text-[#62d8b5]">*</span>
                              )}
                            </p>
                            <p className="mt-0.5 text-[11px] text-[#68706c]">
                              {dataTypes.find(
                                (type) => type.value === attribute.data_type,
                              )?.label ?? attribute.data_type}
                              {!attribute.is_active && " · Inactive"}
                            </p>
                          </div>
                          <button
                            aria-label={`Edit ${attribute.label}`}
                            className="grid size-8 place-items-center rounded-lg text-[#747c78] hover:bg-white/[0.05] hover:text-white"
                            onClick={() => setEditing(attribute)}
                            type="button"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="border-y border-white/[0.08] py-5 text-sm text-[#666e6a]">
                    No custom fields configured.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 border-y border-white/[0.08] py-9 text-center">
          <p className="text-sm text-[#747c78]">
            Add fields such as garden area, view, plot size, parking, or
            frontage.
          </p>
        </div>
      )}

      {editing && (
        <AttributeDialog
          editing={editing === "new" ? null : editing}
          key={editing === "new" ? "new" : editing.definition_id}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
          projectId={projectId}
        />
      )}
    </div>
  );
}
