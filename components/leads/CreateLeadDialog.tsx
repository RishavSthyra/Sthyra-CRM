"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, UserPlus, X } from "lucide-react";
import { fetchWithSession } from "@/lib/clientAuth";
import { isLeadStageAvailableForManualCreation } from "@/lib/manualLeadStagePolicy";

export type CreateLeadProject = {
  project_id: number;
  project_code: string;
  project_name: string;
};

type Stage = {
  stage_key: string;
  stage_name: string;
  position: number;
  is_initial: boolean;
  is_terminal: boolean;
};

type Source = {
  source_id: string;
  source_name: string;
};

export type CreatedLead = {
  lead_id: string;
  project_id?: number;
};

type Props = {
  initialProjectId?: number | null;
  onClose: () => void;
  onCreated: (lead: CreatedLead) => void | Promise<void>;
  projects: CreateLeadProject[];
};

const inputClass =
  "h-11 w-full rounded-xl border border-[#343936] bg-[#0c0e0d] px-3.5 text-sm text-[#f4f6f5] outline-none placeholder:text-[#5e6461] focus:border-[#4fae8d] focus:ring-2 focus:ring-[#4fae8d]/10 disabled:cursor-not-allowed disabled:opacity-55";

function SelectChevron() {
  return (
    <ChevronDown
      aria-hidden
      className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-[#858b88]"
    />
  );
}

export function CreateLeadDialog({
  initialProjectId,
  onClose,
  onCreated,
  projects,
}: Props) {
  const defaultProjectId =
    initialProjectId && projects.some((item) => item.project_id === initialProjectId)
      ? String(initialProjectId)
      : projects[0]
        ? String(projects[0].project_id)
        : "";
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [stages, setStages] = useState<Stage[]>([]);
  const [stageKey, setStageKey] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [subSource, setSubSource] = useState("");
  const [temperature, setTemperature] = useState("");
  const [budget, setBudget] = useState("");
  const [preferredLocation, setPreferredLocation] = useState("");
  const [preferredConfig, setPreferredConfig] = useState("");
  const [buyingReason, setBuyingReason] = useState("");

  const selectableStages = useMemo(
    () => stages.filter(isLeadStageAvailableForManualCreation),
    [stages],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadSources() {
      try {
        const response = await fetchWithSession(
          "/api/lead-sources?is_active=true&limit=100",
          { cache: "no-store" },
        );
        const body = (await response.json()) as {
          sources?: Source[];
          error?: string;
        };
        if (!response.ok) throw new Error(body.error || "Unable to load sources");
        if (!cancelled) setSources(body.sources ?? []);
      } catch {
        if (!cancelled) setSources([]);
      }
    }
    void loadSources();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    async function loadStages() {
      setResourcesLoading(true);
      setResourceError(null);
      setStageKey("");
      try {
        const response = await fetchWithSession(
          `/api/projects/${projectId}/lead-stages`,
          { cache: "no-store", signal: controller.signal },
        );
        const body = (await response.json()) as {
          stages?: Stage[];
          error?: string;
        };
        if (!response.ok) throw new Error(body.error || "Unable to load stages");
        const nextStages = body.stages ?? [];
        const selectable = nextStages.filter(isLeadStageAvailableForManualCreation);
        if (!controller.signal.aborted) {
          setStages(nextStages);
          setStageKey(
            selectable.find((stage) => stage.is_initial)?.stage_key ??
              selectable[0]?.stage_key ??
              "",
          );
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        setResourceError(
          cause instanceof Error ? cause.message : "Unable to load stages",
        );
        setStages([]);
      } finally {
        if (!controller.signal.aborted) setResourcesLoading(false);
      }
    }
    void loadStages();
    return () => controller.abort();
  }, [projectId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!firstName.trim()) {
      setError("First name is required");
      return;
    }
    if (!phone.trim() && !email.trim()) {
      setError("Add a phone number or email address");
      return;
    }
    if (!projectId || !stageKey) {
      setError("Select a project and stage");
      return;
    }
    const budgetValue = budget.trim() ? Number(budget) : null;
    if (budgetValue !== null && (!Number.isFinite(budgetValue) || budgetValue < 0)) {
      setError("Budget must be a valid non-negative amount");
      return;
    }

    setSaving(true);
    try {
      const response = await fetchWithSession("/api/leads/manual", {
        body: JSON.stringify({
          project_id: Number(projectId),
          stage_key: stageKey,
          contact: {
            first_name: firstName.trim(),
            last_name: lastName.trim() || null,
            phone_number: phone.trim() || null,
            email: email.trim() || null,
          },
          lead: {
            source_id: sourceId || null,
            sub_source: subSource.trim() || null,
            temperature: temperature || null,
            budget: budgetValue,
            preferred_location: preferredLocation.trim() || null,
            preferred_config: preferredConfig.trim() || null,
            buying_reason: buyingReason.trim() || null,
          },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as {
        lead?: CreatedLead;
        error?: string;
        details?: string[];
      };
      if (!response.ok || !body.lead) {
        throw new Error(
          body.details?.join(". ") || body.error || "Unable to create lead",
        );
      }
      await onCreated(body.lead);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create lead");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      aria-labelledby="create-lead-title"
      aria-modal="true"
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-4"
      onMouseDown={() => !saving && onClose()}
      role="dialog"
    >
      <form
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#343936] bg-[#121513] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header className="flex items-start justify-between border-b border-[#2d322f] px-6 py-5">
          <div className="flex gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#315f50] bg-[#17372e] text-[#75d0b1]">
              <UserPlus className="size-4.5" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-[#f3f5f4]" id="create-lead-title">
                Add lead
              </h2>
              <p className="mt-1 text-xs text-[#858b88]">
                Create the contact, route the lead, and start its CRM workflow.
              </p>
            </div>
          </div>
          <button
            aria-label="Close add lead dialog"
            className="flex size-9 items-center justify-center rounded-lg text-[#858b88] hover:bg-white/[0.05] hover:text-white disabled:opacity-50"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5">
          <section>
            <h3 className="text-[10px] font-semibold tracking-[0.18em] text-[#777e7a] uppercase">
              Workflow
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-4 max-[680px]:grid-cols-1">
              <label className="space-y-2 text-xs text-[#aeb3b0]">
                <span>Project *</span>
                <span className="relative block">
                  <select
                    className={`${inputClass} appearance-none pr-10`}
                    disabled={saving || projects.length === 0}
                    onChange={(event) => setProjectId(event.target.value)}
                    value={projectId}
                  >
                    {projects.map((project) => (
                      <option key={project.project_id} value={project.project_id}>
                        {project.project_name} · {project.project_code}
                      </option>
                    ))}
                  </select>
                  <SelectChevron />
                </span>
              </label>
              <label className="space-y-2 text-xs text-[#aeb3b0]">
                <span>Stage *</span>
                <span className="relative block">
                  <select
                    className={`${inputClass} appearance-none pr-10`}
                    disabled={saving || resourcesLoading || !selectableStages.length}
                    onChange={(event) => setStageKey(event.target.value)}
                    value={stageKey}
                  >
                    {resourcesLoading && <option value="">Loading stages…</option>}
                    {!resourcesLoading && !selectableStages.length && (
                      <option value="">No available stages</option>
                    )}
                    {selectableStages.map((stage) => (
                      <option key={stage.stage_key} value={stage.stage_key}>
                        {stage.stage_name}{stage.is_initial ? " · Initial" : ""}
                      </option>
                    ))}
                  </select>
                  {resourcesLoading ? (
                    <Loader2 className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin text-[#858b88]" />
                  ) : (
                    <SelectChevron />
                  )}
                </span>
              </label>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-[#686e6b]">
              Qualification, nurturing, and closure use their dedicated actions so related records and audit history stay complete.
            </p>
            {resourceError && <p className="mt-2 text-xs text-[#e99a87]">{resourceError}</p>}
          </section>

          <section className="mt-6 border-t border-[#292e2b] pt-5">
            <h3 className="text-[10px] font-semibold tracking-[0.18em] text-[#777e7a] uppercase">
              Contact
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-4 max-[680px]:grid-cols-1">
              <label className="space-y-2 text-xs text-[#aeb3b0]"><span>First name *</span><input className={inputClass} maxLength={200} onChange={(event) => setFirstName(event.target.value)} placeholder="Aarav" value={firstName} /></label>
              <label className="space-y-2 text-xs text-[#aeb3b0]"><span>Last name</span><input className={inputClass} maxLength={200} onChange={(event) => setLastName(event.target.value)} placeholder="Sharma" value={lastName} /></label>
              <label className="space-y-2 text-xs text-[#aeb3b0]"><span>Phone number</span><input className={inputClass} inputMode="tel" maxLength={20} onChange={(event) => setPhone(event.target.value)} placeholder="+91 98765 43210" value={phone} /></label>
              <label className="space-y-2 text-xs text-[#aeb3b0]"><span>Email</span><input className={inputClass} maxLength={255} onChange={(event) => setEmail(event.target.value)} placeholder="aarav@example.com" type="email" value={email} /></label>
            </div>
            <p className="mt-2 text-[10px] text-[#686e6b]">A phone number or email is required. Existing matching contacts are reused safely.</p>
          </section>

          <section className="mt-6 border-t border-[#292e2b] pt-5">
            <h3 className="text-[10px] font-semibold tracking-[0.18em] text-[#777e7a] uppercase">Lead details</h3>
            <div className="mt-3 grid grid-cols-2 gap-4 max-[680px]:grid-cols-1">
              <label className="space-y-2 text-xs text-[#aeb3b0]"><span>Source</span><span className="relative block"><select className={`${inputClass} appearance-none pr-10`} onChange={(event) => setSourceId(event.target.value)} value={sourceId}><option value="">Not specified</option>{sources.map((source) => <option key={source.source_id} value={source.source_id}>{source.source_name}</option>)}</select><SelectChevron /></span></label>
              <label className="space-y-2 text-xs text-[#aeb3b0]"><span>Subsource</span><input className={inputClass} maxLength={150} onChange={(event) => setSubSource(event.target.value)} placeholder="Landing page, referral…" value={subSource} /></label>
              <label className="space-y-2 text-xs text-[#aeb3b0]"><span>Temperature</span><span className="relative block"><select className={`${inputClass} appearance-none pr-10`} onChange={(event) => setTemperature(event.target.value)} value={temperature}><option value="">Not specified</option><option value="cold">Cold</option><option value="warm">Warm</option><option value="hot">Hot</option></select><SelectChevron /></span></label>
              <label className="space-y-2 text-xs text-[#aeb3b0]"><span>Budget</span><input className={inputClass} min="0" onChange={(event) => setBudget(event.target.value)} placeholder="10000000" step="1" type="number" value={budget} /></label>
              <label className="space-y-2 text-xs text-[#aeb3b0]"><span>Preferred location</span><input className={inputClass} maxLength={200} onChange={(event) => setPreferredLocation(event.target.value)} placeholder="Whitefield" value={preferredLocation} /></label>
              <label className="space-y-2 text-xs text-[#aeb3b0]"><span>Configuration</span><input className={inputClass} maxLength={100} onChange={(event) => setPreferredConfig(event.target.value)} placeholder="3 BHK" value={preferredConfig} /></label>
            </div>
            <label className="mt-4 block space-y-2 text-xs text-[#aeb3b0]"><span>Requirements / buying reason</span><textarea className="min-h-24 w-full resize-y rounded-xl border border-[#343936] bg-[#0c0e0d] px-3.5 py-3 text-sm text-[#f4f6f5] outline-none placeholder:text-[#5e6461] focus:border-[#4fae8d] focus:ring-2 focus:ring-[#4fae8d]/10" maxLength={5000} onChange={(event) => setBuyingReason(event.target.value)} placeholder="What is the customer looking for?" value={buyingReason} /></label>
          </section>

          {error && <div className="mt-5 rounded-xl border border-[#6f3e35] bg-[#2b1c18] px-4 py-3 text-xs text-[#f2ad9c]" role="alert">{error}</div>}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[#2d322f] px-6 py-4">
          <button className="h-10 rounded-lg px-4 text-xs font-medium text-[#a5aaa7] hover:bg-white/[0.04] disabled:opacity-50" disabled={saving} onClick={onClose} type="button">Cancel</button>
          <button className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#247b5d] px-5 text-xs font-semibold text-white hover:bg-[#2d9470] disabled:cursor-not-allowed disabled:opacity-50" disabled={saving || resourcesLoading || !stageKey || !projectId} type="submit">
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {saving ? "Creating…" : "Add lead"}
          </button>
        </footer>
      </form>
    </div>
  );
}
