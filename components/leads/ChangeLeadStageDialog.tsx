"use client";

import { FormEvent, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, LoaderCircle, X } from "lucide-react";
import {
  evaluateManualLeadStageTransition,
  isCommandManagedLeadStage,
  type ManualStageDirection,
} from "@/lib/manualLeadStageTransition";

export type ChangeLeadStageOption = {
  stage_id?: string;
  stage_key: string;
  stage_name: string;
  position: number;
  is_initial: boolean;
  is_terminal: boolean;
};

type Props = {
  leadName: string;
  currentStageKey?: string | null;
  currentStageName?: string | null;
  stages: ChangeLeadStageOption[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  canMoveBackward: boolean;
  onClose: () => void;
  onRetry: () => void;
  onSubmit: (stageKey: string, reason: string) => void;
};

function directionLabel(direction: ManualStageDirection) {
  if (direction === "backward") return "Backward correction";
  if (direction === "forward") return "Forward progression";
  return "Manual correction";
}

export function ChangeLeadStageDialog(props: Props) {
  const [targetStageKey, setTargetStageKey] = useState("");
  const [reason, setReason] = useState("");
  const currentStage = useMemo(
    () =>
      props.stages.find(
        (stage) => stage.stage_key === props.currentStageKey,
      ) ?? null,
    [props.currentStageKey, props.stages],
  );
  const availableStages = useMemo(
    () =>
      props.stages.filter(
        (stage) =>
          !stage.is_terminal &&
          !isCommandManagedLeadStage(stage.stage_key) &&
          stage.stage_key !== props.currentStageKey,
      ),
    [props.currentStageKey, props.stages],
  );
  const targetStage =
    availableStages.find((stage) => stage.stage_key === targetStageKey) ?? null;
  const transition = targetStage
    ? evaluateManualLeadStageTransition({
        currentStage,
        targetStage,
        canMoveBackward: props.canMoveBackward,
      })
    : null;
  const canSubmit = Boolean(
    transition?.ok && reason.trim() && !props.loading && !props.saving,
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || !targetStage) return;
    props.onSubmit(targetStage.stage_key, reason.trim());
  }

  return (
    <div
      aria-labelledby="change-lead-stage-title"
      aria-modal="true"
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/80 p-4 backdrop-blur-[2px]"
      onMouseDown={() => {
        if (!props.saving) props.onClose();
      }}
      role="dialog"
    >
      <form
        className="w-full max-w-[520px] overflow-hidden rounded-2xl border border-[#343936] bg-[#111412] text-[#f2f4f3] shadow-[0_30px_90px_rgba(0,0,0,0.62)]"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header className="flex items-start justify-between gap-5 border-b border-[#2a2e2c] px-6 py-5">
          <div>
            <h2
              className="font-[var(--font-bricolage)] text-lg font-semibold"
              id="change-lead-stage-title"
            >
              Change lead stage
            </h2>
            <p className="mt-1 text-xs text-[#8f9692]">
              {props.leadName}
            </p>
          </div>
          <button
            aria-label="Close stage change dialog"
            className="flex size-8 items-center justify-center rounded-lg border border-transparent text-[#8f9692] hover:border-[#343936] hover:bg-white/[0.03] hover:text-white disabled:opacity-50"
            disabled={props.saving}
            onClick={props.onClose}
            type="button"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="px-6 py-5">
          <div className="rounded-xl border border-[#2b302d] bg-[#171a18] px-4 py-3">
            <span className="block text-[10px] font-medium tracking-[0.12em] text-[#737a76] uppercase">
              Current stage
            </span>
            <strong className="mt-1 block text-sm font-medium text-[#e4e7e5]">
              {props.currentStageName || currentStage?.stage_name || "Not set"}
            </strong>
          </div>

          {props.loading ? (
            <div className="flex min-h-36 items-center justify-center gap-2 text-xs text-[#929895]">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              Loading project stages…
            </div>
          ) : props.error ? (
            <div className="my-5 rounded-xl border border-[#6c4036] bg-[#291b18] p-4">
              <p className="text-xs leading-5 text-[#e8b1a4]">{props.error}</p>
              <button
                className="mt-3 rounded-lg border border-[#815044] px-3 py-2 text-xs font-medium text-[#ffd6cc] hover:bg-white/[0.04]"
                onClick={props.onRetry}
                type="button"
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              <label className="mt-5 block">
                <span className="mb-2 block text-xs font-medium text-[#c5cac7]">
                  Move to
                </span>
                <select
                  className="h-12 w-full appearance-none rounded-xl border border-[#373c39] bg-[#0c0e0d] px-3 text-sm text-[#f0f2f1] outline-none focus:border-[#55ba98] focus:ring-2 focus:ring-[#55ba98]/15 disabled:opacity-50"
                  onChange={(event) => setTargetStageKey(event.target.value)}
                  value={targetStageKey}
                >
                  <option value="">Select a stage</option>
                  {availableStages.map((stage) => {
                    const optionTransition = evaluateManualLeadStageTransition({
                      currentStage,
                      targetStage: stage,
                      canMoveBackward: props.canMoveBackward,
                    });
                    return (
                      <option
                        disabled={!optionTransition.ok}
                        key={stage.stage_key}
                        value={stage.stage_key}
                      >
                        {stage.stage_name}
                        {!optionTransition.ok &&
                        optionTransition.direction === "backward"
                          ? " — manager permission required"
                          : ""}
                      </option>
                    );
                  })}
                </select>
              </label>

              {availableStages.length === 0 && (
                <p className="mt-3 text-xs leading-5 text-[#8f9692]">
                  There are no other manually selectable stages. Qualification,
                  nurturing and closure use their dedicated actions.
                </p>
              )}

              {transition && targetStage && (
                <div
                  className={`mt-4 flex gap-3 rounded-xl border p-3.5 ${transition.direction === "backward" ? "border-[#684a32] bg-[#281f16]" : "border-[#2c443b] bg-[#15221d]"}`}
                >
                  {transition.direction === "backward" ? (
                    <AlertTriangle
                      className="mt-0.5 size-4 shrink-0 text-[#d7a263]"
                      aria-hidden
                    />
                  ) : (
                    <ArrowRight
                      className="mt-0.5 size-4 shrink-0 text-[#65c9a7]"
                      aria-hidden
                    />
                  )}
                  <div>
                    <strong className="block text-xs font-medium text-[#e1e5e3]">
                      {directionLabel(transition.direction)}
                    </strong>
                    <p className="mt-1 text-[11px] leading-5 text-[#969d99]">
                      {transition.direction === "backward"
                        ? "This is an administrative correction and will be retained in the lead history."
                        : `The lead will move to ${targetStage.stage_name}. Call outcomes can continue advancing it automatically.`}
                    </p>
                  </div>
                </div>
              )}

              <label className="mt-5 block">
                <span className="mb-2 block text-xs font-medium text-[#c5cac7]">
                  Reason <span className="text-[#d68d7c]">*</span>
                </span>
                <textarea
                  className="min-h-28 w-full resize-y rounded-xl border border-[#373c39] bg-[#0c0e0d] px-3 py-3 text-sm leading-5 text-[#f0f2f1] outline-none placeholder:text-[#606662] focus:border-[#55ba98] focus:ring-2 focus:ring-[#55ba98]/15"
                  maxLength={5000}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Explain why this stage is being changed"
                  value={reason}
                />
                <span className="mt-1.5 block text-[10px] text-[#717773]">
                  Required for the audit history · {reason.length}/5000
                </span>
              </label>
            </>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[#2a2e2c] bg-[#0e100f] px-6 py-4">
          <button
            className="h-10 rounded-lg px-4 text-xs font-medium text-[#a0a6a2] hover:bg-white/[0.04] disabled:opacity-50"
            disabled={props.saving}
            onClick={props.onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-10 min-w-32 rounded-lg bg-[#247b5d] px-4 text-xs font-semibold text-white hover:bg-[#2d9470] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canSubmit}
            type="submit"
          >
            {props.saving
              ? "Changing…"
              : targetStage
                ? `Move to ${targetStage.stage_name}`
                : "Change stage"}
          </button>
        </footer>
      </form>
    </div>
  );
}

