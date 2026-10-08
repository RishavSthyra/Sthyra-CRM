"use client";

import {
  Check,
  ChevronDown,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";

type User = {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

type Participant = {
  participant_id?: string;
  participant_type: "user" | "contact" | "external";
  user_id?: string | null;
  contact_id?: string | null;
  external_name?: string | null;
  external_email?: string | null;
  external_phone?: string | null;
  participant_role: string;
  attendance_status: string;
  user_first_name?: string | null;
  user_last_name?: string | null;
  user_email?: string | null;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  contact_email?: string | null;
};

type Unit = {
  unit_id: string;
  unit_code: string;
  unit_name?: string | null;
  type_name?: string | null;
  status?: string;
};

type ShownUnit = Unit & {
  interest_level?: string | null;
  notes?: string | null;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithSession(url, { cache: "no-store", ...init });
  if (!response.ok) throw new Error(await getApiError(response));
  return (await response.json()) as T;
}

function name(participant: Participant) {
  if (participant.participant_type === "external")
    return participant.external_name || "External attendee";
  const first =
    participant.participant_type === "user"
      ? participant.user_first_name
      : participant.contact_first_name;
  const last =
    participant.participant_type === "user"
      ? participant.user_last_name
      : participant.contact_last_name;
  return [first, last].filter(Boolean).join(" ") || "Participant";
}

export function SiteVisitDetails({
  visitId,
  projectId,
  status,
  users,
}: {
  visitId: string;
  projectId: number;
  status: string;
  users: User[];
}) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantDraft, setParticipantDraft] = useState<Participant[]>([]);
  const [shownUnits, setShownUnits] = useState<ShownUnit[]>([]);
  const [projectUnits, setProjectUnits] = useState<Unit[]>([]);
  const [mode, setMode] = useState<"participants" | "units" | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedUser, setSelectedUser] = useState("");
  const [memberMenuOpen, setMemberMenuOpen] = useState(false);
  const [externalName, setExternalName] = useState("");
  const [externalEmail, setExternalEmail] = useState("");
  const [selectedUnits, setSelectedUnits] = useState<Record<string, string>>(
    {},
  );
  const [unitQuery, setUnitQuery] = useState("");
  const [unitLoading, setUnitLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [participantData, shownData, unitData] = await Promise.all([
        api<{ participants?: Participant[] }>(
          `/api/site-visits/${visitId}/participants`,
        ),
        api<{ units?: ShownUnit[] }>(`/api/site-visits/${visitId}/units-shown`),
        api<{ units?: Unit[] }>(
          `/api/inventory/units?project_id=${projectId}&limit=200`,
        ),
      ]);
      setParticipants(participantData.participants ?? []);
      setShownUnits(shownData.units ?? []);
      setProjectUnits(unitData.units ?? []);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load visit details",
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, visitId]);

  useEffect(() => {
    if (mode !== "units") return;
    const task = window.setTimeout(async () => {
      setUnitLoading(true);
      try {
        const query = new URLSearchParams({
          project_id: String(projectId),
          limit: "200",
        });
        if (unitQuery.trim()) query.set("search", unitQuery.trim());
        const data = await api<{ units?: Unit[] }>(
          `/api/inventory/units?${query}`,
        );
        setProjectUnits((current) => {
          const selected = current.filter(
            (unit) => unit.unit_id in selectedUnits,
          );
          return [
            ...selected,
            ...(data.units ?? []).filter(
              (unit) => !selected.some((item) => item.unit_id === unit.unit_id),
            ),
          ];
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Unable to search inventory",
        );
      } finally {
        setUnitLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(task);
  }, [mode, projectId, selectedUnits, unitQuery]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const availableUsers = useMemo(
    () =>
      users.filter(
        (user) =>
          !participantDraft.some(
            (participant) => participant.user_id === user.user_id,
          ),
      ),
    [participantDraft, users],
  );

  function closeModal() {
    setMemberMenuOpen(false);
    setMode(null);
  }

  function openParticipants() {
    setParticipantDraft(
      participants.map((participant) => ({ ...participant })),
    );
    setSelectedUser("");
    setExternalName("");
    setExternalEmail("");
    setMemberMenuOpen(false);
    setMode("participants");
  }

  function openUnits() {
    setSelectedUnits(
      Object.fromEntries(
        shownUnits.map((unit) => [
          unit.unit_id,
          unit.interest_level ?? "medium",
        ]),
      ),
    );
    setMode("units");
  }

  async function saveParticipants(next: Participant[]) {
    setSaving(true);
    try {
      const data = await api<{ participants?: Participant[] }>(
        `/api/site-visits/${visitId}/participants`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participants: next.map((participant) => ({
              participant_type: participant.participant_type,
              user_id: participant.user_id || undefined,
              contact_id: participant.contact_id || undefined,
              external_name: participant.external_name || undefined,
              external_email: participant.external_email || null,
              external_phone: participant.external_phone || null,
              participant_role: participant.participant_role,
              attendance_status: participant.attendance_status,
            })),
          }),
        },
      );
      setParticipants(data.participants ?? next);
      toast.success("Participants updated");
      closeModal();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save participants",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveUnits() {
    setSaving(true);
    try {
      await api(`/api/site-visits/${visitId}/units-shown`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          units: Object.entries(selectedUnits).map(
            ([unit_id, interest_level], index) => ({
              unit_id,
              display_order: index + 1,
              interest_level,
            }),
          ),
        }),
      });
      toast.success("Units shown updated");
      closeModal();
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save units shown",
      );
    } finally {
      setSaving(false);
    }
  }

  const canEditParticipants = !["completed", "cancelled", "no_show"].includes(
    status,
  );
  const canEditUnits = !["cancelled", "no_show"].includes(status);

  if (loading)
    return (
      <div className="flex items-center gap-2 border-t border-white/[0.09] py-5 text-[11px] text-[#747b77]">
        <LoaderCircle className="size-3.5 animate-spin" /> Loading visit
        details…
      </div>
    );

  return (
    <>
      <div className="border-t border-white/[0.09] py-5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[9px] uppercase tracking-[0.12em] text-[#6f7471]">
            <UsersRound className="size-3.5" /> Participants
          </span>
          {canEditParticipants && (
            <button
              className="text-[#65d4b4]"
              onClick={openParticipants}
              type="button"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
        </div>
        <div className="mt-3 space-y-2">
          {participants.length ? (
            participants.map((participant) => (
              <div
                className="flex items-center justify-between gap-3 text-xs"
                key={
                  participant.participant_id ??
                  `${participant.participant_type}-${participant.user_id ?? participant.contact_id ?? participant.external_name}`
                }
              >
                <span className="truncate text-[#d3d8d5]">
                  {name(participant)}
                </span>
                <span className="shrink-0 capitalize text-[10px] text-[#737b76]">
                  {participant.participant_role.replaceAll("_", " ")}
                </span>
              </div>
            ))
          ) : (
            <p className="text-[11px] text-[#68706c]">No participants added.</p>
          )}
        </div>
      </div>

      <div className="border-t border-white/[0.09] py-5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[9px] uppercase tracking-[0.12em] text-[#6f7471]">
            <MapPin className="size-3.5" /> Units shown
          </span>
          {canEditUnits && (
            <button
              className="text-[#65d4b4]"
              onClick={openUnits}
              type="button"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
        </div>
        <div className="mt-3 space-y-2">
          {shownUnits.length ? (
            shownUnits.map((unit) => (
              <div
                className="flex items-center justify-between gap-3 text-xs"
                key={unit.unit_id}
              >
                <span className="truncate text-[#d3d8d5]">
                  {unit.unit_code}
                  {unit.unit_name ? ` · ${unit.unit_name}` : ""}
                </span>
                <span className="shrink-0 capitalize text-[10px] text-[#65cfae]">
                  {unit.interest_level ?? "shown"}
                </span>
              </div>
            ))
          ) : (
            <p className="text-[11px] text-[#68706c]">No units recorded yet.</p>
          )}
        </div>
      </div>

      {mode && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={(event) =>
            event.target === event.currentTarget && !saving && closeModal()
          }
        >
          <section className="max-h-[82vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/[0.12] bg-[#111412] shadow-2xl [scrollbar-width:none]">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.09] bg-[#111412] px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  {mode === "participants"
                    ? "Visit participants"
                    : "Units shown"}
                </h3>
                <p className="mt-1 text-[10px] text-[#737b76]">
                  {mode === "participants"
                    ? "Keep at least one internal organizer or host."
                    : "Record the inventory presented during this visit."}
                </p>
              </div>
              <button
                className="text-[#858c88]"
                disabled={saving}
                onClick={closeModal}
                type="button"
              >
                <X className="size-4" />
              </button>
            </header>

            {mode === "participants" ? (
              <div>
                <div className="space-y-5 p-5">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[10px] font-medium text-[#9ca39f]">
                        Current participants
                      </p>
                      <span className="text-[10px] text-[#69706c]">
                        {participantDraft.length}
                      </span>
                    </div>
                    <div className="divide-y divide-white/[0.07] border-y border-white/[0.08]">
                      {participantDraft.map((participant, index) => {
                        const protectedOrganizer =
                          participant.participant_type === "user" &&
                          ["organizer", "host"].includes(
                            participant.participant_role,
                          ) &&
                          participantDraft.filter(
                            (item) =>
                              item.participant_type === "user" &&
                              ["organizer", "host"].includes(
                                item.participant_role,
                              ),
                          ).length === 1;
                        return (
                          <div
                            className="flex items-center gap-3 py-3"
                            key={participant.participant_id ?? index}
                          >
                            <span className="min-w-0 flex-1 truncate text-xs text-[#d8ddda]">
                              {name(participant)}
                            </span>
                            <span className="shrink-0 text-[10px] capitalize text-[#747c77]">
                              {participant.participant_role.replaceAll(
                                "_",
                                " ",
                              )}
                            </span>
                            <button
                              aria-label={`Remove ${name(participant)}`}
                              className="text-[#8a928d] hover:text-[#ef8c7d] disabled:opacity-30"
                              disabled={protectedOrganizer || saving}
                              onClick={() =>
                                setParticipantDraft((current) =>
                                  current.filter(
                                    (_, itemIndex) => itemIndex !== index,
                                  ),
                                )
                              }
                              title={
                                protectedOrganizer
                                  ? "A visit must keep an organizer or host"
                                  : "Remove participant"
                              }
                              type="button"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-[10px] font-medium text-[#9ca39f]">
                      Add team member
                    </p>
                    <div className="flex gap-2">
                      <div className="relative min-w-0 flex-1">
                        <button
                          aria-expanded={memberMenuOpen}
                          aria-haspopup="listbox"
                          className="flex h-10 w-full items-center justify-between gap-3 rounded-md border border-white/[0.1] bg-[#0a0d0b] px-3 text-left text-xs text-white outline-none transition hover:border-white/[0.18] focus-visible:border-[#55cdaa] focus-visible:ring-2 focus-visible:ring-[#55cdaa]/15"
                          onClick={() =>
                            setMemberMenuOpen((current) => !current)
                          }
                          type="button"
                        >
                          <span
                            className={`truncate ${selectedUser ? "text-white" : "text-[#69706c]"}`}
                          >
                            {(() => {
                              const user = users.find(
                                (item) => item.user_id === selectedUser,
                              );
                              return user
                                ? [user.first_name, user.last_name]
                                    .filter(Boolean)
                                    .join(" ") || user.email
                                : "Select a team member";
                            })()}
                          </span>
                          <ChevronDown
                            className={`size-3.5 shrink-0 text-[#858c88] transition ${memberMenuOpen ? "rotate-180" : ""}`}
                          />
                        </button>
                        {memberMenuOpen && (
                          <div
                            className="absolute top-[calc(100%+6px)] right-0 left-0 z-20 max-h-44 overflow-y-auto rounded-lg border border-white/[0.12] bg-[#151816] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.55)] [scrollbar-width:thin]"
                            role="listbox"
                          >
                            {availableUsers.length ? (
                              availableUsers.map((user) => {
                                const userName =
                                  [user.first_name, user.last_name]
                                    .filter(Boolean)
                                    .join(" ") || user.email || "Team member";
                                return (
                                  <button
                                    className="flex w-full flex-col rounded-md px-2.5 py-2 text-left hover:bg-white/[0.06]"
                                    key={user.user_id}
                                    onClick={() => {
                                      setSelectedUser(user.user_id);
                                      setMemberMenuOpen(false);
                                    }}
                                    aria-selected={
                                      selectedUser === user.user_id
                                    }
                                    role="option"
                                    type="button"
                                  >
                                    <span className="truncate text-xs text-[#e4e8e5]">
                                      {userName}
                                    </span>
                                    {user.email && user.email !== userName && (
                                      <span className="mt-0.5 truncate text-[10px] text-[#717975]">
                                        {user.email}
                                      </span>
                                    )}
                                  </button>
                                );
                              })
                            ) : (
                              <p className="px-2.5 py-2 text-[11px] text-[#717975]">
                                All team members are already included.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[#237e66] text-white transition hover:bg-[#2b9277] disabled:opacity-40"
                        disabled={!selectedUser || saving}
                        onClick={() => {
                          const user = users.find(
                            (item) => item.user_id === selectedUser,
                          );
                          if (!user) return;
                          setParticipantDraft((current) => [
                            ...current,
                            {
                              participant_type: "user",
                              user_id: user.user_id,
                              participant_role: "attendee",
                              attendance_status: "expected",
                              user_first_name: user.first_name,
                              user_last_name: user.last_name,
                              user_email: user.email,
                            },
                          ]);
                          setSelectedUser("");
                        }}
                        title="Add team member"
                        type="button"
                      >
                        <Plus className="size-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-[10px] font-medium text-[#9ca39f]">
                      Add external attendee
                    </p>
                    <div className="grid grid-cols-2 gap-2 max-[480px]:grid-cols-1">
                      <input
                        className="h-10 min-w-0 rounded-md border border-white/[0.1] bg-[#0a0d0b] px-3 text-xs text-white outline-none placeholder:text-[#59615c] focus:border-[#55cdaa]"
                        onChange={(event) => setExternalName(event.target.value)}
                        placeholder="Full name"
                        value={externalName}
                      />
                      <input
                        className="h-10 min-w-0 rounded-md border border-white/[0.1] bg-[#0a0d0b] px-3 text-xs text-white outline-none placeholder:text-[#59615c] focus:border-[#55cdaa]"
                        onChange={(event) =>
                          setExternalEmail(event.target.value)
                        }
                        placeholder="Email (optional)"
                        type="email"
                        value={externalEmail}
                      />
                    </div>
                    <button
                      className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.1] px-3 text-[11px] text-[#d6dad7] transition hover:border-white/[0.18] hover:bg-white/[0.04] disabled:opacity-40"
                      disabled={!externalName.trim() || saving}
                      onClick={() => {
                        setParticipantDraft((current) => [
                          ...current,
                          {
                            participant_type: "external",
                            external_name: externalName.trim(),
                            external_email: externalEmail.trim() || null,
                            participant_role: "attendee",
                            attendance_status: "expected",
                          },
                        ]);
                        setExternalName("");
                        setExternalEmail("");
                      }}
                      type="button"
                    >
                      <Plus className="size-3.5" /> Add attendee
                    </button>
                  </div>
                </div>
                <div className="flex justify-end gap-2 border-t border-white/[0.09] px-5 py-4">
                  <button
                    className="h-9 rounded-md border border-white/[0.1] px-4 text-xs text-[#cbd0cd]"
                    disabled={saving}
                    onClick={closeModal}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-[#237e66] px-4 text-xs font-semibold text-white transition hover:bg-[#2b9277] disabled:opacity-40"
                    disabled={saving}
                    onClick={() => void saveParticipants(participantDraft)}
                    type="button"
                  >
                    {saving ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Check className="size-3.5" />
                    )}
                    Save participants
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-5">
                <div className="relative mb-3">
                  <input
                    className="h-9 w-full rounded-md border border-white/[0.1] bg-[#0a0d0b] px-3 pr-9 text-xs text-white outline-none placeholder:text-[#59615c] focus:border-[#55cdaa]"
                    onChange={(event) => setUnitQuery(event.target.value)}
                    placeholder="Search unit code, name or type"
                    value={unitQuery}
                  />
                  {unitLoading && (
                    <LoaderCircle className="absolute top-1/2 right-3 size-3.5 -translate-y-1/2 animate-spin text-[#55d1ae]" />
                  )}
                </div>
                <div className="max-h-[52vh] divide-y divide-white/[0.07] overflow-y-auto border-y border-white/[0.08] [scrollbar-width:none]">
                  {projectUnits.map((unit) => {
                    const checked = unit.unit_id in selectedUnits;
                    return (
                      <div
                        className="flex items-center gap-3 py-3"
                        key={unit.unit_id}
                      >
                        <input
                          checked={checked}
                          className="accent-[#55d1ae]"
                          onChange={(event) =>
                            setSelectedUnits((current) => {
                              const next = { ...current };
                              if (event.target.checked)
                                next[unit.unit_id] = "medium";
                              else delete next[unit.unit_id];
                              return next;
                            })
                          }
                          type="checkbox"
                        />
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-xs text-[#dce1de]">
                            {unit.unit_code}
                          </strong>
                          <span className="text-[10px] text-[#68706c]">
                            {unit.unit_name || unit.type_name || unit.status}
                          </span>
                        </span>
                        {checked && (
                          <select
                            className="h-8 rounded-md border border-white/[0.09] bg-[#0b0e0c] px-2 text-[10px] text-white"
                            onChange={(event) =>
                              setSelectedUnits((current) => ({
                                ...current,
                                [unit.unit_id]: event.target.value,
                              }))
                            }
                            value={selectedUnits[unit.unit_id]}
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="selected">Selected</option>
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    className="h-9 rounded-md border border-white/[0.1] px-4 text-xs text-[#cbd0cd]"
                    disabled={saving}
                    onClick={() => setMode(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-[#237e66] px-4 text-xs font-semibold text-white disabled:opacity-40"
                    disabled={saving}
                    onClick={() => void saveUnits()}
                    type="button"
                  >
                    {saving ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Check className="size-3.5" />
                    )}{" "}
                    Save units
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
