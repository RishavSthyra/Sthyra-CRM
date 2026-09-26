"use client";

import {
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Clock3,
  Download,
  File,
  Forward,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  RichTextContent,
  RichTextEditor,
  safeRichHtml,
} from "@/components/activity/RichTextEditor";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";

type ViewProps = {
  projectId: string | null;
  creationProjectId: number | null;
  sort: "newest" | "oldest";
};

type CallRecord = {
  call_id: string;
  direction: "inbound" | "outbound";
  status: string;
  phone_number: string;
  subject: string;
  summary?: string | null;
  started_at: string;
  duration_seconds?: number | null;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  owner_first_name?: string | null;
  owner_last_name?: string | null;
  project_name?: string;
};

type EmailRecord = {
  email_id: string;
  lead_id?: string | null;
  direction: "inbound" | "outbound";
  status: string;
  subject: string;
  body: string;
  from_address: string;
  to_addresses: string[];
  sent_at?: string | null;
  received_at?: string | null;
  created_at: string;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  owner_first_name?: string | null;
  owner_last_name?: string | null;
  attachments?: EmailAttachment[];
};

type EmailAttachment = {
  attachment_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
};

type PendingAttachment = Omit<EmailAttachment, "attachment_id"> & {
  key: string;
  content_base64: string;
};

type EmailConnection = {
  email_connection_id: string;
  provider: "google" | "microsoft";
  email_address: string;
  display_name: string | null;
  status: string;
  is_default: boolean;
};

type TaskRecord = {
  task_id: string;
  title: string;
  description?: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "in_progress" | "completed" | "cancelled";
  due_at?: string | null;
  created_at: string;
  assignee_first_name?: string | null;
  assignee_last_name?: string | null;
};

type TaskStatus = TaskRecord["status"];

type NoteRecord = {
  note_id: string;
  lead_id?: string | null;
  title?: string | null;
  body: string;
  visibility: string;
  is_pinned: boolean;
  created_at: string;
  author_first_name?: string | null;
  author_last_name?: string | null;
};

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function personName(
  first?: string | null,
  last?: string | null,
  fallback = "CRM",
) {
  return [first, last].filter(Boolean).join(" ") || fallback;
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    ...(withTime
      ? { hour: "numeric", minute: "2-digit" }
      : { year: "numeric" }),
  }).format(date);
}

function formatDuration(value?: number | null) {
  if (value === null || value === undefined) return "—";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function endpoint(path: string, projectId: string | null) {
  const params = new URLSearchParams({ limit: "100" });
  if (projectId && projectId !== "all") params.set("project_id", projectId);
  return `${path}?${params.toString()}`;
}

function LoadingRows() {
  return (
    <div className="space-y-2 p-4" aria-label="Loading">
      {Array.from({ length: 7 }, (_, index) => (
        <div
          className="h-14 animate-pulse rounded-lg border border-[#242424] bg-[#151515]"
          key={index}
        />
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center text-center">
      <div>
        <span className="mx-auto flex size-10 items-center justify-center rounded-full border border-[#303332] bg-[#171918] text-[#777b79]">
          <Clock3 className="size-4" aria-hidden />
        </span>
        <p className="mt-3 text-sm text-[#d6d8d7]">No {label} yet</p>
        <p className="mt-1 text-[11px] text-[#707371]">
          New records will appear here automatically.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-[11px] text-[#dfe1df]">
      {label}
      {children}
    </label>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-[#303231] bg-[#0e100f] px-3 text-xs text-[#eef0ef] outline-none placeholder:text-[#626664] focus:border-[#2a8f71] focus:ring-2 focus:ring-[#2a8f71]/15";

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return window.btoa(binary);
}

function plainText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function CallsView({ projectId, sort }: ViewProps) {
  const router = useRouter();
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response = await fetchWithSession(endpoint("/api/calls", projectId), {
        cache: "no-store",
      });
      if (response.status === 401) return router.replace("/login");
      if (!response.ok) throw new Error(await getApiError(response));
      const body = (await response.json()) as { calls?: CallRecord[] };
      setCalls(body.calls ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to retrieve calls.");
    } finally {
      setLoading(false);
    }
  }, [projectId, router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const rows = useMemo(
    () =>
      [...calls].sort((a, b) => {
        const difference = new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
        return sort === "newest" ? difference : -difference;
      }),
    [calls, sort],
  );

  if (loading) return <LoadingRows />;
  if (error) return <EmptyState label={error} />;
  if (!rows.length) return <EmptyState label="calls" />;

  return (
    <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <table className="w-full min-w-[920px] table-fixed border-collapse text-left">
        <thead className="border-b border-[#282828] text-[10px] font-medium text-[#9a9d9b]">
          <tr>
            <th className="w-[27%] px-4 py-3 font-medium">Contacts</th>
            <th className="w-[14%] px-3 py-3 font-medium">Type</th>
            <th className="w-[15%] px-3 py-3 font-medium">Calls made</th>
            <th className="w-[20%] px-3 py-3 font-medium">Remarks</th>
            <th className="w-[11%] px-3 py-3 font-medium">Duration</th>
            <th className="w-[13%] px-3 py-3 font-medium">Date</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.map((call) => {
            const contact = personName(
              call.contact_first_name,
              call.contact_last_name,
              call.subject,
            );
            const owner = personName(
              call.owner_first_name,
              call.owner_last_name,
              call.project_name || "Unassigned",
            );
            const missed = call.status === "missed";
            return (
              <tr className="border-b border-[#202020] text-[11px] text-[#d9dcda]" key={call.call_id}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#303231] text-[9px] font-semibold">
                      {initials(contact)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[#f0f1f0]">{contact}</p>
                      <p className="mt-0.5 truncate text-[9px] text-[#868987]">{call.phone_number}</p>
                    </div>
                  </div>
                </td>
                <td className={`px-3 py-3 ${missed ? "text-[#ef4c4c]" : "text-[#d9dcda]"}`}>
                  <span className="flex items-center gap-1.5">
                    {call.direction === "outbound" ? (
                      <ArrowUpRight className="size-3.5" aria-hidden />
                    ) : (
                      <ArrowDownLeft className="size-3.5" aria-hidden />
                    )}
                    {missed ? "Missed Call" : call.direction === "outbound" ? "Outgoing" : "Incoming"}
                  </span>
                </td>
                <td className="truncate px-3 py-3">{owner}</td>
                <td className="truncate px-3 py-3 text-[#aeb1af]">{call.summary || call.subject}</td>
                <td className="px-3 py-3">
                  <span className="flex items-center gap-1.5">
                    <Clock3 className="size-3.5" aria-hidden />
                    {formatDuration(call.duration_seconds)}
                  </span>
                </td>
                <td className="px-3 py-3 text-[#b4b7b5]">{formatDate(call.started_at, true)}</td>
                <td className="px-3 py-3 text-right">
                  <button aria-label={`Actions for ${contact}`} className="text-[#b4b7b5] hover:text-white" type="button">
                    <MoreHorizontal className="size-4" aria-hidden />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmailMessageView({
  email,
  index,
  onForward,
  onReply,
  total,
}: {
  email: EmailRecord;
  index: number;
  onForward: () => void;
  onReply: () => void;
  total: number;
}) {
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="truncate text-sm font-semibold text-[#eceeed]">
          {email.subject}
        </h2>
        <span className="shrink-0 text-[9px] text-[#747775]">
          {index} of {total}
        </span>
      </div>
      <article className="rounded-[10px] border border-[#2c2c2c] bg-[#191919] p-4">
        <header className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#eef2f0] text-[9px] font-semibold text-[#202221]">
            {initials(
              personName(
                email.contact_first_name,
                email.contact_last_name,
                email.from_address,
              ),
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-[#eff1f0]">
              {personName(
                email.contact_first_name,
                email.contact_last_name,
                email.from_address,
              )}
            </p>
            <p className="truncate text-[9px] text-[#858886]">
              &lt;{email.from_address}&gt;
            </p>
          </div>
          <time className="text-[9px] text-[#777a78]">
            {formatDate(email.sent_at || email.received_at || email.created_at, true)}
          </time>
          <MoreHorizontal className="size-4 text-[#8c8f8d]" aria-hidden />
        </header>
        <RichTextContent
          className="mt-4 text-[11px] leading-[1.65] text-[#d4d6d5]"
          value={email.body}
        />
        {(email.attachments?.length ?? 0) > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[#2d302e] pt-3">
            {email.attachments?.map((attachment) => (
              <a
                className="flex h-9 max-w-64 items-center gap-2 rounded-lg border border-[#353835] bg-[#202220] px-3 text-[10px] text-[#d7dad8] transition hover:border-[#467761] hover:bg-[#252a27]"
                href={`/api/emails/${email.email_id}/attachments/${attachment.attachment_id}`}
                key={attachment.attachment_id}
              >
                <File className="size-3.5 shrink-0 text-[#6bceaa]" aria-hidden />
                <span className="truncate">{attachment.file_name}</span>
                <Download className="size-3.5 shrink-0 text-[#8d918e]" aria-hidden />
              </a>
            ))}
          </div>
        )}
        <div className="mt-5 flex gap-2 border-t border-[#2d302e] pt-4">
          <button
            className="flex h-9 items-center gap-2 rounded-lg border border-[#343735] bg-[#202220] px-4 text-[10px] text-[#d5d8d6] transition hover:border-[#466b5d] hover:bg-[#252a27]"
            onClick={onReply}
            type="button"
          >
            <Reply className="size-3.5" aria-hidden /> Reply
          </button>
          <button
            className="flex h-9 items-center gap-2 rounded-lg border border-[#343735] bg-[#202220] px-4 text-[10px] text-[#d5d8d6] transition hover:border-[#466b5d] hover:bg-[#252a27]"
            onClick={onForward}
            type="button"
          >
            <Forward className="size-3.5" aria-hidden /> Forward
          </button>
        </div>
      </article>
    </>
  );
}

export function EmailView({
  projectId,
  creationProjectId,
  initialCompose,
  onInitialComposeConsumed,
  sort,
}: ViewProps & {
  initialCompose?: { key: string; leadId: string; to: string } | null;
  onInitialComposeConsumed?: () => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeMode, setComposeMode] = useState<"new" | "reply" | "forward">("new");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [relatedLeadId, setRelatedLeadId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [connections, setConnections] = useState<EmailConnection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const consumedComposeKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response = await fetchWithSession(endpoint("/api/emails", projectId), {
        cache: "no-store",
      });
      if (response.status === 401) return router.replace("/login");
      if (!response.ok) throw new Error(await getApiError(response));
      const payload = (await response.json()) as { emails?: EmailRecord[] };
      const next = payload.emails ?? [];
      setEmails(next);
      setSelectedId((current) => current && next.some((item) => item.email_id === current) ? current : next[0]?.email_id ?? null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to retrieve emails.");
    } finally {
      setLoading(false);
    }
  }, [projectId, router]);

  const loadConnections = useCallback(async () => {
    try {
      const response = await fetchWithSession("/api/email-connections", { cache: "no-store" });
      if (response.status === 401) return router.replace("/login");
      if (!response.ok) throw new Error(await getApiError(response));
      const payload = (await response.json()) as { connections?: EmailConnection[] };
      const next = (payload.connections ?? []).filter((item) => item.status === "connected");
      setConnections(next);
      setConnectionId((current) =>
        next.some((item) => item.email_connection_id === current)
          ? current
          : next.find((item) => item.is_default)?.email_connection_id ?? next[0]?.email_connection_id ?? "",
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to retrieve email accounts.");
    }
  }, [router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadConnections(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadConnections]);

  const rows = useMemo(
    () =>
      [...emails].sort((a, b) => {
        const getTime = (item: EmailRecord) => new Date(item.sent_at || item.received_at || item.created_at).getTime();
        const difference = getTime(b) - getTime(a);
        return sort === "newest" ? difference : -difference;
      }),
    [emails, sort],
  );
  const selected = rows.find((item) => item.email_id === selectedId) ?? rows[0];

  function beginCompose(mode: "new" | "reply" | "forward") {
    setComposeMode(mode);
    setCc("");
    setShowCc(false);
    setAttachments([]);
    if (mode === "new" || !selected) {
      setTo("");
      setSubject("");
      setBody("");
      setRelatedLeadId(null);
    } else if (mode === "reply") {
      setTo(
        selected.direction === "inbound"
          ? selected.from_address
          : selected.to_addresses[0] || "",
      );
      setSubject(
        /^re:/i.test(selected.subject)
          ? selected.subject
          : `Re: ${selected.subject}`,
      );
      setBody("");
      setRelatedLeadId(selected.lead_id ?? null);
    } else {
      setTo("");
      setSubject(
        /^fwd:/i.test(selected.subject)
          ? selected.subject
          : `Fwd: ${selected.subject}`,
      );
      setBody(
        `<div><br></div><div>---------- Forwarded message ----------</div><div>From: ${selected.from_address}</div><div>Subject: ${selected.subject}</div><div><br></div><div>${safeRichHtml(selected.body)}</div>`,
      );
      setRelatedLeadId(selected.lead_id ?? null);
    }
    setComposing(true);
  }

  useEffect(() => {
    if (
      !initialCompose ||
      consumedComposeKey.current === initialCompose.key
    ) return;
    consumedComposeKey.current = initialCompose.key;
    setComposeMode("new");
    setTo(initialCompose.to);
    setCc("");
    setShowCc(false);
    setSubject("");
    setBody("");
    setAttachments([]);
    setRelatedLeadId(initialCompose.leadId);
    setComposing(true);
    onInitialComposeConsumed?.();
  }, [initialCompose, onInitialComposeConsumed]);

  async function addAttachments(files: FileList | null) {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    if (attachments.length + selectedFiles.length > 10) {
      toast.error("You can attach up to 10 files.");
      return;
    }
    const oversized = selectedFiles.find((file) => file.size > 10 * 1024 * 1024);
    if (oversized) {
      toast.error(`${oversized.name} is larger than 10 MB.`);
      return;
    }
    const existingSize = attachments.reduce((sum, file) => sum + file.size_bytes, 0);
    const addedSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    if (existingSize + addedSize > 20 * 1024 * 1024) {
      toast.error("Attachments may not exceed 20 MB in total.");
      return;
    }
    try {
      const encoded = await Promise.all(
        selectedFiles.map(async (file) => ({
          key: `${file.name}-${file.size}-${file.lastModified}`,
          file_name: file.name,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          content_base64: arrayBufferToBase64(await file.arrayBuffer()),
        })),
      );
      setAttachments((current) => [...current, ...encoded]);
    } catch {
      toast.error("Unable to read the selected attachment.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function sendEmail(event: FormEvent) {
    event.preventDefault();
    if (!creationProjectId) return toast.error("Choose a project before sending an email.");
    if (!connectionId) return toast.error("Connect Gmail or Outlook before sending an email.");
    const recipients = to.split(",").map((value) => value.trim()).filter(Boolean);
    if (!recipients.length) return toast.error("Add at least one recipient.");
    if (!subject.trim()) return toast.error("Add a subject.");
    if (!plainText(body)) return toast.error("Write a message before sending.");
    setSending(true);
    try {
      const response = await fetchWithSession("/api/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: creationProjectId,
          email_connection_id: connectionId,
          lead_id: relatedLeadId,
          direction: "outbound",
          subject,
          body,
          to_addresses: recipients,
          cc_addresses: cc.split(",").map((value) => value.trim()).filter(Boolean),
          attachments: attachments.map((attachment) => ({
            file_name: attachment.file_name,
            mime_type: attachment.mime_type,
            size_bytes: attachment.size_bytes,
            content_base64: attachment.content_base64,
          })),
        }),
      });
      if (response.status === 401) return router.replace("/login");
      if (!response.ok) throw new Error(await getApiError(response));
      const result = (await response.json()) as {
        delivery?: { configured?: boolean; sent?: boolean };
      };
      toast.success(result.delivery?.sent ? "Email sent" : "Email queued");
      setTo("");
      setSubject("");
      setBody("");
      setCc("");
      setRelatedLeadId(null);
      setAttachments([]);
      setComposing(false);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to send email.");
    } finally {
      setSending(false);
    }
  }

  if (loading) return <LoadingRows />;
  if (!rows.length && !composing) return (
    <div className="relative min-h-[620px]">
      <EmptyState label="emails" />
      <CreateButton label="Compose" onClick={() => beginCompose("new")} />
    </div>
  );

  return (
    <div className="grid min-h-[620px] grid-cols-[minmax(310px,44%)_minmax(0,56%)] max-[900px]:grid-cols-1">
      <section className="border-r border-[#292929] px-4 py-4 max-[900px]:border-r-0 max-[900px]:border-b">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#eceeed]">Inbox ({rows.length})</h2>
          <MoreHorizontal className="size-4 text-[#b2b5b3]" aria-hidden />
        </div>
        <div className="max-h-[570px] space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {rows.map((email) => {
            const sender = email.direction === "inbound"
              ? personName(email.contact_first_name, email.contact_last_name, email.from_address)
              : personName(email.owner_first_name, email.owner_last_name, "You");
            const time = email.sent_at || email.received_at || email.created_at;
            return (
              <button
                className={`flex w-full items-start gap-3 rounded-md border-0 p-3 text-left transition ${selected?.email_id === email.email_id ? "bg-[#2c2c2c]" : "bg-[#111] hover:bg-[#191919]"}`}
                key={email.email_id}
                onClick={() => { setSelectedId(email.email_id); setComposing(false); }}
                type="button"
              >
                <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[#eef2f0] text-[9px] font-semibold text-[#202221]">
                  {initials(sender)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <strong className="truncate text-[11px] text-[#f0f1f0]">{sender}</strong>
                    <time className="shrink-0 text-[9px] text-[#737674]">{formatDate(time, true)}</time>
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-[#d4d6d5]">{email.subject}</span>
                  <span className="mt-0.5 block truncate text-[9px] text-[#858886]">{email.body}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="relative min-h-[620px] bg-[#0b0c0b] px-5 py-4">
        {composing && selected && (
          <EmailMessageView
            email={selected}
            index={Math.max(
              1,
              rows.findIndex((row) => row.email_id === selected.email_id) + 1,
            )}
            onForward={() => beginCompose("forward")}
            onReply={() => beginCompose("reply")}
            total={rows.length}
          />
        )}
        {composing ? (
          <form className="absolute right-4 bottom-4 z-20 flex h-[540px] max-h-[calc(100%-32px)] w-[min(620px,calc(100%-32px))] flex-col overflow-hidden rounded-xl border border-[#3a3d3b] bg-[#151716] shadow-[0_28px_90px_rgba(0,0,0,.78)]" onSubmit={sendEmail}>
            <div className="flex h-11 items-center justify-between border-b border-[#2c2f2d] bg-[#1b1e1c] px-4">
              <span className="text-xs font-medium text-[#e7e9e8]">
                {composeMode === "reply" ? "Reply" : composeMode === "forward" ? "Forward message" : "New message"}
              </span>
              <button aria-label="Close composer" className="text-[#a5a8a6] hover:text-white" onClick={() => setComposing(false)} type="button">
                <X className="size-4" aria-hidden />
              </button>
            </div>
            {connections.length ? (
              <label className="flex min-h-11 items-center gap-3 border-b border-[#292c2a] px-4 text-[11px] text-[#898d8a]">
                <span className="w-8 shrink-0">From</span>
                <select className="min-w-0 flex-1 appearance-none bg-transparent text-xs text-[#edf0ee] outline-none" onChange={(event) => setConnectionId(event.target.value)} value={connectionId}>
                  {connections.map((connection) => (
                    <option className="bg-[#151716]" key={connection.email_connection_id} value={connection.email_connection_id}>
                      {connection.email_address} · {connection.provider === "google" ? "Gmail" : "Outlook"}
                    </option>
                  ))}
                </select>
                <ChevronDown className="size-3.5 text-[#777b78]" aria-hidden />
              </label>
            ) : (
              <div className="flex min-h-14 items-center justify-between gap-3 border-b border-amber-300/15 bg-amber-300/[0.05] px-4 text-[10px] text-amber-100/80">
                <span>Connect Gmail or Outlook to send from your own address.</span>
                <Link className="shrink-0 rounded-lg border border-amber-200/20 px-3 py-1.5 font-semibold text-amber-100 transition hover:bg-amber-200/10" href="/settings?section=email-accounts">Connect account</Link>
              </div>
            )}
            <label className="flex min-h-11 items-center gap-3 border-b border-[#292c2a] px-4 text-[11px] text-[#898d8a]">
              <span className="w-8 shrink-0">To</span>
              <input className="min-w-0 flex-1 bg-transparent text-xs text-[#edf0ee] outline-none placeholder:text-[#626663]" onChange={(event) => setTo(event.target.value)} placeholder="Recipients, separated by commas" type="text" value={to} />
              <button className="text-[10px] text-[#a8aca9] hover:text-white" onClick={() => setShowCc((current) => !current)} type="button">Cc</button>
            </label>
            {showCc && (
              <label className="flex min-h-11 items-center gap-3 border-b border-[#292c2a] px-4 text-[11px] text-[#898d8a]">
                <span className="w-8 shrink-0">Cc</span>
                <input className="min-w-0 flex-1 bg-transparent text-xs text-[#edf0ee] outline-none placeholder:text-[#626663]" onChange={(event) => setCc(event.target.value)} placeholder="CC recipients" type="text" value={cc} />
              </label>
            )}
            <input className="h-11 border-0 border-b border-[#292c2a] bg-transparent px-4 text-xs font-medium text-[#f0f1f0] outline-none placeholder:text-[#777b78]" onChange={(event) => setSubject(event.target.value)} placeholder="Subject" value={subject} />
            <div className="min-h-0 flex-1 p-3">
              <RichTextEditor ariaLabel="Email message" minHeight="min-h-[230px]" onChange={setBody} placeholder="Write your email..." value={body} />
            </div>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-[#292c2a] px-4 py-3">
                {attachments.map((attachment) => (
                  <span className="flex h-8 max-w-64 items-center gap-2 rounded-lg border border-[#343735] bg-[#202321] px-2.5 text-[10px] text-[#d7dad8]" key={attachment.key}>
                    <File className="size-3.5 shrink-0 text-[#69c8a5]" aria-hidden />
                    <span className="truncate">{attachment.file_name}</span>
                    <span className="shrink-0 text-[#747875]">{formatBytes(attachment.size_bytes)}</span>
                    <button aria-label={`Remove ${attachment.file_name}`} className="ml-1 text-[#8e928f] hover:text-white" onClick={() => setAttachments((current) => current.filter((item) => item.key !== attachment.key))} type="button"><X className="size-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between border-t border-[#2c2f2d] bg-[#181a19] px-4 py-3">
              <div className="flex items-center gap-1">
                <input className="hidden" multiple onChange={(event) => void addAttachments(event.target.files)} ref={fileInputRef} type="file" />
                <button aria-label="Attach files" className="flex size-8 items-center justify-center rounded-md text-[#b7bab8] transition hover:bg-white/[0.07] hover:text-white" onClick={() => fileInputRef.current?.click()} type="button"><Paperclip className="size-4" aria-hidden /></button>
                <span className="text-[9px] text-[#6f7370]">Max 10 MB per file</span>
              </div>
              <button className="flex h-9 items-center gap-2 rounded-lg bg-[#1f704d] px-5 text-[11px] font-medium text-white transition hover:bg-[#27845c] disabled:opacity-50" disabled={sending || !connectionId} type="submit">
                {sending ? "Sending..." : "Send Mail"}
                <Send className="size-3.5" aria-hidden />
              </button>
            </div>
          </form>
        ) : selected ? (
          <>
            <EmailMessageView
              email={selected}
              index={Math.max(
                1,
                rows.findIndex((row) => row.email_id === selected.email_id) + 1,
              )}
              onForward={() => beginCompose("forward")}
              onReply={() => beginCompose("reply")}
              total={rows.length}
            />
            <CreateButton label="Compose" onClick={() => beginCompose("new")} />
          </>
        ) : null}
      </section>
    </div>
  );
}

function CreateButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="fixed right-8 bottom-6 z-40 flex h-10 items-center gap-2 rounded-full bg-[#1f704d] px-5 text-[11px] font-medium text-white shadow-[0_12px_36px_rgba(0,0,0,.58)] transition hover:-translate-y-0.5 hover:bg-[#27845c] max-[700px]:right-4 max-[700px]:bottom-4" onClick={onClick} type="button">
      {label}<Plus className="size-3.5" aria-hidden />
    </button>
  );
}

const taskColumns = [
  { status: "open", label: "To-do", tone: "bg-[#1c5261] text-[#9ed8e7]" },
  { status: "in_progress", label: "In progress", tone: "bg-[#514717] text-[#e2cf76]" },
  { status: "completed", label: "Done", tone: "bg-[#254d22] text-[#a7dba0]" },
  { status: "cancelled", label: "Canceled", tone: "bg-[#582121] text-[#ef9b9b]" },
] as const;

export function TasksView({ projectId, creationProjectId, sort }: ViewProps) {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<"open" | "in_progress">("open");
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
  const [dueAt, setDueAt] = useState("");
  const [description, setDescription] = useState("");
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [movingTaskIds, setMovingTaskIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response = await fetchWithSession(endpoint("/api/tasks", projectId), { cache: "no-store" });
      if (response.status === 401) return router.replace("/login");
      if (!response.ok) throw new Error(await getApiError(response));
      const payload = (await response.json()) as { tasks?: TaskRecord[] };
      setTasks(payload.tasks ?? []);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to retrieve tasks.");
    } finally {
      setLoading(false);
    }
  }, [projectId, router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function createTask(event: FormEvent) {
    event.preventDefault();
    if (!creationProjectId) return toast.error("Choose a project before creating a task.");
    setSaving(true);
    try {
      const response = await fetchWithSession("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: creationProjectId, title, description: description || null, status, priority, due_at: dueAt ? new Date(dueAt).toISOString() : null }),
      });
      if (response.status === 401) return router.replace("/login");
      if (!response.ok) throw new Error(await getApiError(response));
      toast.success("Task created");
      setDialogOpen(false); setTitle(""); setDescription(""); setDueAt("");
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to create task.");
    } finally { setSaving(false); }
  }

  async function taskRequest(path: string, init?: RequestInit) {
    const response = await fetchWithSession(path, init);
    if (response.status === 401) {
      router.replace("/login");
      throw new Error("Your session has expired.");
    }
    if (!response.ok) throw new Error(await getApiError(response));
    return response;
  }

  async function moveTask(task: TaskRecord, targetStatus: TaskStatus) {
    if (task.status === targetStatus || movingTaskIds.has(task.task_id)) return;

    setTasks((current) =>
      current.map((item) =>
        item.task_id === task.task_id
          ? { ...item, status: targetStatus }
          : item,
      ),
    );
    setMovingTaskIds((current) => new Set(current).add(task.task_id));
    setDraggedTaskId(null);
    setDragOverStatus(null);

    try {
      const taskPath = `/api/tasks/${task.task_id}`;
      const sourceWasTerminal =
        task.status === "completed" || task.status === "cancelled";

      if (sourceWasTerminal) {
        await taskRequest(`${taskPath}/reopen`, { method: "POST" });
      }

      if (targetStatus === "completed") {
        await taskRequest(`${taskPath}/complete`, { method: "POST" });
      } else if (targetStatus === "cancelled") {
        await taskRequest(`${taskPath}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Moved to Canceled on the task board" }),
        });
      } else if (targetStatus === "in_progress" || !sourceWasTerminal) {
        await taskRequest(taskPath, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: targetStatus }),
        });
      }

      const label = taskColumns.find(
        (column) => column.status === targetStatus,
      )?.label;
      toast.success(`Moved to ${label ?? targetStatus}`);
    } catch (cause) {
      setTasks((current) =>
        current.map((item) =>
          item.task_id === task.task_id
            ? { ...item, status: task.status }
            : item,
        ),
      );
      toast.error(
        cause instanceof Error ? cause.message : "Unable to move task.",
      );
    } finally {
      setMovingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.task_id);
        return next;
      });
    }
  }

  function beginTaskDrag(event: DragEvent<HTMLElement>, task: TaskRecord) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.task_id);
    setDraggedTaskId(task.task_id);
  }

  function allowTaskDrop(event: DragEvent<HTMLElement>, status: TaskStatus) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverStatus !== status) setDragOverStatus(status);
  }

  function dropTask(event: DragEvent<HTMLElement>, status: TaskStatus) {
    event.preventDefault();
    const taskId =
      draggedTaskId || event.dataTransfer.getData("text/plain");
    const task = tasks.find((item) => item.task_id === taskId);
    setDragOverStatus(null);
    if (task) void moveTask(task, status);
  }

  if (loading) return <LoadingRows />;
  const ordered = [...tasks].sort((a, b) => {
    const difference = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return sort === "newest" ? difference : -difference;
  });

  return (
    <div className="relative min-h-[620px]">
      <div className="grid min-h-[620px] grid-cols-4 gap-2 p-3 max-[1000px]:grid-cols-2 max-[650px]:grid-cols-1">
        {taskColumns.map((column) => {
          const columnTasks = ordered.filter((task) => task.status === column.status);
          return (
            <section
              className={`rounded-lg border p-3 transition-[background-color,border-color,box-shadow] duration-150 ${
                dragOverStatus === column.status
                  ? "border-[#2f8d6d] bg-[#101713] shadow-[inset_0_0_0_1px_rgba(47,141,109,.18)]"
                  : "border-transparent bg-[#111]"
              }`}
              key={column.status}
              onDragEnter={(event) => allowTaskDrop(event, column.status)}
              onDragOver={(event) => allowTaskDrop(event, column.status)}
              onDrop={(event) => dropTask(event, column.status)}
            >
              <header className="mb-3 flex items-center justify-between text-[11px] font-medium text-[#eef0ef]">
                <span>{column.label}</span>
                <button aria-label={`Add ${column.label} task`} className="text-[#a9adaa] hover:text-white" onClick={() => { if (column.status === "open" || column.status === "in_progress") setStatus(column.status); setDialogOpen(true); }} type="button"><Plus className="size-3.5" /></button>
              </header>
              <div className="space-y-2">
                {columnTasks.map((task) => {
                  const assignee = personName(task.assignee_first_name, task.assignee_last_name, "Unassigned");
                  return (
                    <article
                      aria-busy={movingTaskIds.has(task.task_id)}
                      className={`rounded-lg border border-[#2c2c2c] bg-[#191919] p-3 shadow-sm transition-[transform,opacity,border-color,box-shadow] duration-150 will-change-transform hover:-translate-y-0.5 hover:border-[#3b4944] hover:shadow-[0_8px_24px_rgba(0,0,0,.24)] active:cursor-grabbing ${
                        draggedTaskId === task.task_id
                          ? "cursor-grabbing opacity-35"
                          : "cursor-grab"
                      } ${
                        movingTaskIds.has(task.task_id)
                          ? "pointer-events-none opacity-55"
                          : ""
                      }`}
                      draggable={!movingTaskIds.has(task.task_id)}
                      key={task.task_id}
                      onDragEnd={() => {
                        setDraggedTaskId(null);
                        setDragOverStatus(null);
                      }}
                      onDragStart={(event) => beginTaskDrag(event, task)}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`rounded-full px-2 py-1 text-[8px] font-medium ${column.tone}`}>{column.label}</span>
                        <MoreHorizontal className="size-4 text-[#b6b9b7]" aria-hidden />
                      </div>
                      <h3 className="mt-3 line-clamp-2 text-[11px] font-medium text-[#f0f1f0]">{task.title}</h3>
                      {task.description && (
                        <RichTextContent className="mt-2 line-clamp-2 text-[9px] leading-[1.45] text-[#969a97]" value={task.description} />
                      )}
                      <p className="mt-2 flex items-center gap-1.5 text-[9px] text-[#949795]"><CalendarDays className="size-3" aria-hidden />{formatDate(task.due_at)}</p>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="flex -space-x-1.5" title={assignee}><span className="flex size-5 items-center justify-center rounded-full border border-[#191919] bg-[#50c7a0] text-[7px] text-[#10221c]">{initials(assignee)}</span><span className="size-5 rounded-full border border-[#191919] bg-[#7659e8]" /></span>
                        <span className="text-[8px] capitalize text-[#707472]">{task.priority} priority</span>
                      </div>
                    </article>
                  );
                })}
                {!columnTasks.length && (
                  <div
                    className={`flex min-h-24 items-center justify-center rounded-lg border border-dashed text-[10px] transition ${
                      dragOverStatus === column.status
                        ? "border-[#397e67] bg-[#173126]/40 text-[#78bca3]"
                        : "border-transparent text-[#5f6260]"
                    }`}
                  >
                    {dragOverStatus === column.status
                      ? `Move to ${column.label}`
                      : "No tasks"}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <CreateButton label="Add Tasks" onClick={() => setDialogOpen(true)} />
      {dialogOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-5 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) setDialogOpen(false); }}>
          <form className="w-full max-w-[700px] rounded-2xl border border-[#2c2c2c] bg-[#111] p-6 shadow-[0_25px_70px_rgba(0,0,0,.75)]" onSubmit={createTask}>
            <h2 className="font-[var(--font-bricolage)] text-lg font-semibold">Create New Task</h2>
            <div className="mt-5 flex items-center justify-between gap-4"><span className="text-xs text-[#e2e4e3]">Task Information</span><span className="relative"><select className="h-8 appearance-none rounded-lg border border-[#333] bg-[#232323] pr-8 pl-3 text-[11px] outline-none" onChange={(event) => setStatus(event.target.value as "open" | "in_progress")} value={status}><option value="open">To-do</option><option value="in_progress">In progress</option></select><ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2" /></span></div>
            <div className="mt-4 space-y-4">
              <Field label="Task Name"><input className={inputClass} onChange={(event) => setTitle(event.target.value)} placeholder="Task name" required value={title} /></Field>
              <Field label="Priority"><span className="relative"><select className={`${inputClass} appearance-none pr-9`} onChange={(event) => setPriority(event.target.value as typeof priority)} value={priority}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select><ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2" /></span></Field>
              <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1"><Field label="Start Date"><input className={inputClass} type="date" /></Field><Field label="End Date"><input className={inputClass} onChange={(event) => setDueAt(event.target.value)} required type="date" value={dueAt} /></Field></div>
              <Field label="Description"><RichTextEditor ariaLabel="Task description" minHeight="min-h-28" onChange={setDescription} placeholder="Task description" value={description} /></Field>
            </div>
            <div className="mt-5 flex justify-end gap-3"><button className="h-9 rounded-full bg-[#171918] px-8 text-[11px] hover:bg-[#232523]" onClick={() => setDialogOpen(false)} type="button">Cancel</button><button className="h-9 rounded-full bg-[#1f704d] px-8 text-[11px] font-medium hover:bg-[#27845c] disabled:opacity-50" disabled={saving} type="submit">{saving ? "Creating..." : "Confirm"}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

export function NotesView({ projectId, creationProjectId, sort }: ViewProps) {
  const router = useRouter();
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<NoteRecord | null>(null);
  const [editingNote, setEditingNote] = useState<NoteRecord | null>(null);
  const [deletingNote, setDeletingNote] = useState<NoteRecord | null>(null);
  const [menuNoteId, setMenuNoteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState("");
  const [leadId, setLeadId] = useState("");
  const [body, setBody] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response = await fetchWithSession(endpoint("/api/notes", projectId), { cache: "no-store" });
      if (response.status === 401) return router.replace("/login");
      if (!response.ok) throw new Error(await getApiError(response));
      const payload = (await response.json()) as { notes?: NoteRecord[] };
      setNotes(payload.notes ?? []);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to retrieve notes.");
    } finally { setLoading(false); }
  }, [projectId, router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    if (!menuNoteId) return;
    function closeMenu(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(`[data-note-menu="${menuNoteId}"]`)
      ) return;
      setMenuNoteId(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuNoteId(null);
    }
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuNoteId]);

  function resetNoteForm() {
    setDialogOpen(false);
    setEditingNote(null);
    setTitle("");
    setLeadId("");
    setBody("");
  }

  function openCreateNote() {
    setEditingNote(null);
    setTitle("");
    setLeadId("");
    setBody("");
    setDialogOpen(true);
  }

  function openEditNote(note: NoteRecord) {
    setEditingNote(note);
    setTitle(note.title ?? "");
    setLeadId(note.lead_id ?? "");
    setBody(note.body);
    setMenuNoteId(null);
    setDialogOpen(true);
  }

  async function saveNote(event: FormEvent) {
    event.preventDefault();
    if (!editingNote && !creationProjectId) return toast.error("Choose a project before adding a note.");
    if (!plainText(body)) return toast.error("Write the note before saving.");
    setSaving(true);
    try {
      const response = await fetchWithSession(
        editingNote ? `/api/notes/${editingNote.note_id}` : "/api/notes",
        {
          method: editingNote ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editingNote
              ? { title: title || null, body, lead_id: leadId || null }
              : { project_id: creationProjectId, title: title || null, body, visibility: "company", lead_id: leadId || null },
          ),
        },
      );
      if (response.status === 401) return router.replace("/login");
      if (!response.ok) throw new Error(await getApiError(response));
      toast.success(editingNote ? "Note updated" : "Note added");
      if (selected?.note_id === editingNote?.note_id) setSelected(null);
      resetNoteForm();
      await load();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Unable to save note."); }
    finally { setSaving(false); }
  }

  async function deleteNote() {
    if (!deletingNote) return;
    setDeleting(true);
    try {
      const response = await fetchWithSession(
        `/api/notes/${deletingNote.note_id}/archive`,
        { method: "POST" },
      );
      if (response.status === 401) return router.replace("/login");
      if (!response.ok) throw new Error(await getApiError(response));
      setNotes((current) =>
        current.filter((note) => note.note_id !== deletingNote.note_id),
      );
      if (selected?.note_id === deletingNote.note_id) setSelected(null);
      toast.success("Note deleted");
      setDeletingNote(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to delete note.");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <LoadingRows />;
  const ordered = [...notes].sort((a, b) => { const difference = new Date(b.created_at).getTime() - new Date(a.created_at).getTime(); return sort === "newest" ? difference : -difference; });

  return (
    <div className="relative min-h-[620px] p-3">
      {ordered.length ? (
        <div className="grid grid-cols-4 gap-3 max-[1150px]:grid-cols-3 max-[850px]:grid-cols-2 max-[560px]:grid-cols-1">
          {ordered.map((note, index) => (
            <article className="relative min-h-48 rounded-[10px] border border-[#2c2c2c] bg-[#111] p-3 text-left transition hover:border-[#3c4a45] hover:bg-[#151715]" key={note.note_id}>
              <div className="flex items-center justify-between text-[9px] text-[#a4a7a5]">
                <span>Notes{index + 1} {note.lead_id ? `• Lead ID:${note.lead_id.slice(0, 8)}` : ""}</span>
                <div className="relative" data-note-menu={note.note_id}>
                  <button
                    aria-expanded={menuNoteId === note.note_id}
                    aria-label={`Actions for ${note.title || "note"}`}
                    className="flex size-7 items-center justify-center rounded-md text-[#a4a7a5] transition hover:bg-white/[0.07] hover:text-white"
                    onClick={() => setMenuNoteId((current) => current === note.note_id ? null : note.note_id)}
                    type="button"
                  >
                    <MoreHorizontal className="size-4" aria-hidden />
                  </button>
                  {menuNoteId === note.note_id && (
                    <div className="absolute top-8 right-0 z-30 w-32 rounded-lg border border-[#343735] bg-[#191b1a] p-1 shadow-[0_16px_40px_rgba(0,0,0,.65)]">
                      <button className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-[10px] text-[#d9dcda] transition hover:bg-white/[0.07] hover:text-white" onClick={() => openEditNote(note)} type="button"><Pencil className="size-3.5" aria-hidden />Edit</button>
                      <button className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-[10px] text-[#ed9898] transition hover:bg-[#4b2323]/60 hover:text-[#ffb1b1]" onClick={() => { setDeletingNote(note); setMenuNoteId(null); }} type="button"><Trash2 className="size-3.5" aria-hidden />Delete</button>
                    </div>
                  )}
                </div>
              </div>
              <button className="mt-3 block w-full rounded-md bg-[#191919] p-3 text-left transition hover:bg-[#1d1f1e]" onClick={() => setSelected(note)} type="button">
                <strong className="line-clamp-2 text-[11px] font-medium text-[#f0f1f0]">{note.title || "Untitled note"}</strong>
                <span className="mt-2 block text-[9px] text-[#aaa]">{personName(note.author_first_name, note.author_last_name, "CRM note")}</span>
                <span className="mt-2 block text-[9px] text-[#c1c3c2]">{note.visibility === "company" ? "Shared with company" : `Visibility: ${note.visibility}`}</span>
                <RichTextContent className="mt-4 line-clamp-5 text-[9px] leading-[1.45] text-[#a0a3a1]" value={note.body} />
              </button>
            </article>
          ))}
        </div>
      ) : <EmptyState label="notes" />}
      <CreateButton label="Add Notes" onClick={openCreateNote} />
      {dialogOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-5 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) resetNoteForm(); }}>
          <form className="w-full max-w-[620px] rounded-2xl border border-[#2c2c2c] bg-[#111] p-6 shadow-[0_25px_70px_rgba(0,0,0,.75)]" onSubmit={saveNote}>
            <div className="flex items-center justify-between"><h2 className="font-[var(--font-bricolage)] text-lg font-semibold">{editingNote ? "Edit note" : "Add new note"}</h2><button aria-label="Close note dialog" onClick={resetNoteForm} type="button"><X className="size-4 text-[#999]" /></button></div>
            <div className="mt-5 space-y-4"><Field label="Topic"><input className={inputClass} onChange={(event) => setTitle(event.target.value)} placeholder="Note title" value={title} /></Field><Field label="Lead ID (optional)"><input className={inputClass} onChange={(event) => setLeadId(event.target.value)} placeholder="UUID of the related lead" value={leadId} /></Field><Field label="Description"><RichTextEditor ariaLabel="Note description" minHeight="min-h-32" onChange={setBody} placeholder="Write the note..." value={body} /></Field></div>
            <div className="mt-5 flex justify-end gap-3"><button className="h-9 rounded-full bg-[#171918] px-8 text-[11px] hover:bg-[#232523]" onClick={resetNoteForm} type="button">Cancel</button><button className="h-9 rounded-full bg-[#1f704d] px-8 text-[11px] font-medium hover:bg-[#27845c] disabled:opacity-50" disabled={saving} type="submit">{saving ? "Saving..." : editingNote ? "Save changes" : "Confirm"}</button></div>
          </form>
        </div>
      )}
      {deletingNote && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-5 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target && !deleting) setDeletingNote(null); }}>
          <div className="w-full max-w-sm rounded-2xl border border-[#343735] bg-[#151716] p-5 shadow-[0_25px_70px_rgba(0,0,0,.75)]">
            <div className="flex size-9 items-center justify-center rounded-lg bg-[#4b2323] text-[#ffaaaa]"><Trash2 className="size-4" aria-hidden /></div>
            <h2 className="mt-4 font-[var(--font-bricolage)] text-base font-semibold text-[#f1f3f2]">Delete this note?</h2>
            <p className="mt-2 text-[11px] leading-5 text-[#929694]">“{deletingNote.title || "Untitled note"}” will be removed from the active notes list.</p>
            <div className="mt-5 flex justify-end gap-2"><button className="h-9 rounded-lg border border-[#343735] bg-[#1d1f1e] px-4 text-[11px] text-[#dadddb] hover:bg-[#252826]" disabled={deleting} onClick={() => setDeletingNote(null)} type="button">Cancel</button><button className="h-9 rounded-lg bg-[#8d3838] px-4 text-[11px] font-medium text-white hover:bg-[#a64343] disabled:opacity-50" disabled={deleting} onClick={() => void deleteNote()} type="button">{deleting ? "Deleting..." : "Delete note"}</button></div>
          </div>
        </div>
      )}
      {selected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-5 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
          <article className="w-full max-w-[720px] rounded-2xl border border-[#2c2c2c] bg-[#191919] p-6 shadow-[0_25px_70px_rgba(0,0,0,.75)]">
            <header className="flex items-start justify-between gap-4"><div><p className="text-[10px] text-[#898c8a]">{selected.lead_id ? `Lead ID: ${selected.lead_id}` : "General note"}</p><h2 className="mt-2 font-[var(--font-bricolage)] text-xl font-semibold">{selected.title || "Untitled note"}</h2></div><button aria-label="Close note" onClick={() => setSelected(null)} type="button"><X className="size-4 text-[#999]" /></button></header>
            <RichTextContent className="mt-6 text-xs leading-6 text-[#cdd0ce]" value={selected.body} />
          </article>
        </div>
      )}
    </div>
  );
}
