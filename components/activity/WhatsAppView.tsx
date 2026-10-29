"use client";

import Script from "next/script";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Check, CheckCheck, CircleAlert, Cloud, MessageCircle, Plus, RefreshCw, Send, Settings2, Sparkles, X } from "lucide-react";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";

type Props = { projectId: string | null; creationProjectId: number | null; sort: "newest" | "oldest" };
type Section = "inbox" | "templates" | "automations" | "setup";
type Connection = {
  whatsapp_connection_id: string; project_id: number; waba_id: string; phone_number_id: string;
  display_phone_number: string | null; verified_name: string | null; quality_rating: string | null;
  status: string; last_webhook_at: string | null; last_error: string | null;
};
type Message = {
  whatsapp_message_id: string; lead_id: string | null; contact_id: string | null;
  direction: "inbound" | "outbound"; message_type: string; status: string;
  recipient_phone: string; body: string | null; template_name: string | null;
  sent_at: string | null; received_at: string | null; created_at: string;
  contact_first_name: string | null; contact_last_name: string | null; last_inbound_at: string | null;
};
type Template = {
  whatsapp_template_id: string; project_id: number; name: string; language: string;
  category: string; status: string; components: Array<{ type?: string; text?: string }>;
  rejection_reason: string | null;
};
type Automation = {
  whatsapp_automation_rule_id: string; project_id: number; name: string;
  trigger_activity_type: string; template_name: string; template_status: string; is_active: boolean;
};
type Lead = { lead_id: string; first_name: string; last_name: string | null; phone_number: string | null };
type EmbeddedConfig = { configured: boolean; app_id: string | null; config_id: string | null; graph_version: string };

declare global {
  interface Window {
    FB?: {
      init: (options: Record<string, unknown>) => void;
      login: (callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>) => void;
    };
    fbAsyncInit?: () => void;
  }
}
const control = "h-10 w-full rounded-md border border-[#303332] bg-[#0d0f0e] px-3 text-xs text-[#ecefed] outline-none placeholder:text-[#606462] focus:border-[#4d8f78]";
const triggerLabels: Record<string, string> = {
  lead_created: "Lead created", lead_qualified: "Lead qualified", appointment_created: "Appointment created",
  site_visit_scheduled: "Site visit scheduled", site_visit_completed: "Site visit completed",
  quotation_sent: "Quotation shared", quotation_accepted: "Quotation accepted",
  booking_confirmed: "Booking confirmed", task_created: "Task created",
};

function time(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function person(message: Message) {
  return [message.contact_first_name, message.contact_last_name].filter(Boolean).join(" ") || message.recipient_phone;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "read") return <CheckCheck className="size-3.5 text-[#63b99a]" aria-label="Read" />;
  if (status === "delivered") return <CheckCheck className="size-3.5 text-[#8c918e]" aria-label="Delivered" />;
  if (["sent", "queued", "sending"].includes(status)) return <Check className="size-3.5 text-[#8c918e]" aria-label={status} />;
  return <CircleAlert className="size-3.5 text-[#d78372]" aria-label={status} />;
}

export function WhatsAppView({ projectId, creationProjectId, sort }: Props) {
  const router = useRouter();
  const [section, setSection] = useState<Section>("inbox");
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [triggers, setTriggers] = useState<string[]>(Object.keys(triggerLabels));
  const [leads, setLeads] = useState<Lead[]>([]);
  const [config, setConfig] = useState<EmbeddedConfig | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [selectedLead, setSelectedLead] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [parameters, setParameters] = useState("");
  const [confirmOptIn, setConfirmOptIn] = useState(false);
  const [sending, setSending] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [templateExamples, setTemplateExamples] = useState("");
  const [templateCategory, setTemplateCategory] = useState("UTILITY");
  const [templateLanguage, setTemplateLanguage] = useState("en");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [automationName, setAutomationName] = useState("");
  const [automationTrigger, setAutomationTrigger] = useState("lead_qualified");
  const [automationTemplate, setAutomationTemplate] = useState("");
  const [automationParameters, setAutomationParameters] = useState("{{first_name}}, {{project_name}}");
  const [busy, setBusy] = useState(false);
  const signupSession = useRef<{ waba_id: string; phone_number_id: string; business_id?: string } | null>(null);
  const signupCode = useRef<string | null>(null);

  const activeProjectId = projectId && projectId !== "all" ? Number(projectId) : creationProjectId;
  const connection = connections.find((item) => item.project_id === activeProjectId) ?? null;
  const approvedTemplates = templates.filter((item) => item.project_id === activeProjectId && item.status === "APPROVED");

  const load = useCallback(async (sync = false) => {
    setLoading(true);
    try {
      const suffix = activeProjectId ? `?project_id=${activeProjectId}` : "";
      const [connectionsResponse, messagesResponse, templatesResponse, automationsResponse, leadsResponse] = await Promise.all([
        fetchWithSession("/api/whatsapp/connections", { cache: "no-store" }),
        fetchWithSession(`/api/whatsapp/messages${suffix}`, { cache: "no-store" }),
        fetchWithSession(`/api/whatsapp/templates${suffix}${sync ? `${suffix ? "&" : "?"}sync=1` : ""}`, { cache: "no-store" }),
        fetchWithSession("/api/whatsapp/automations", { cache: "no-store" }),
        activeProjectId
          ? fetchWithSession(`/api/leads?project_id=${activeProjectId}&limit=100&include_summary=false`, { cache: "no-store" })
          : Promise.resolve(null),
      ]);
      if (connectionsResponse.status === 401) return router.replace("/login");
      if (!connectionsResponse.ok) throw new Error(await getApiError(connectionsResponse));
      const connectionPayload = await connectionsResponse.json();
      setConnections(connectionPayload.connections ?? []); setConfig(connectionPayload.embedded_signup ?? null); setCanManage(Boolean(connectionPayload.can_manage));
      if (messagesResponse.ok) setMessages((await messagesResponse.json()).messages ?? []);
      if (templatesResponse.ok) setTemplates((await templatesResponse.json()).templates ?? []);
      if (automationsResponse.ok) {
        const payload = await automationsResponse.json(); setAutomations(payload.rules ?? []); setTriggers(payload.triggers ?? Object.keys(triggerLabels));
      }
      if (leadsResponse?.ok) setLeads((await leadsResponse.json()).leads ?? []);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load WhatsApp"); }
    finally { setLoading(false); }
  }, [activeProjectId, router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (!event.origin.endsWith("facebook.com")) return;
      let payload: unknown = event.data;
      if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { return; } }
      if (!payload || typeof payload !== "object") return;
      const value = payload as { type?: string; event?: string; data?: Record<string, string> };
      if (value.type === "WA_EMBEDDED_SIGNUP" && value.event === "FINISH" && value.data?.waba_id && value.data?.phone_number_id) {
        signupSession.current = { waba_id: value.data.waba_id, phone_number_id: value.data.phone_number_id, business_id: value.data.business_id };
        void completeSignup();
      }
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  });

  async function completeSignup() {
    if (!signupSession.current || !signupCode.current || !activeProjectId) return;
    setBusy(true);
    try {
      const response = await fetchWithSession("/api/whatsapp/connections", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: activeProjectId, code: signupCode.current, ...signupSession.current }),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      toast.success("WhatsApp Business connected"); signupCode.current = null; signupSession.current = null; await load(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to connect WhatsApp"); }
    finally { setBusy(false); }
  }

  function initializeFacebook() {
    if (!config?.app_id || !window.FB) return;
    window.FB.init({ appId: config.app_id, cookie: true, xfbml: false, version: config.graph_version });
  }

  function connectMeta() {
    if (!activeProjectId) return toast.error("Choose a project first");
    if (!config?.configured || !config.config_id || !window.FB) return toast.error("Meta Embedded Signup is not configured yet");
    signupCode.current = null; signupSession.current = null;
    window.FB.login((response) => {
      const code = response.authResponse?.code;
      if (!code) return toast.error("Meta signup was cancelled or did not return a code");
      signupCode.current = code; void completeSignup();
    }, {
      config_id: config.config_id, response_type: "code", override_default_response_type: true,
      extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
    });
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!activeProjectId || !selectedLead) return toast.error("Choose a lead");
    if (!selectedTemplate && !messageBody.trim()) return toast.error("Write a reply or select a template");
    setSending(true);
    try {
      const response = await fetchWithSession("/api/whatsapp/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: activeProjectId, lead_id: selectedLead, body: messageBody,
          whatsapp_template_id: selectedTemplate || null,
          template_parameters: parameters.split(",").map((value) => value.trim()).filter(Boolean),
          confirm_opt_in: confirmOptIn,
        }),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const payload = await response.json();
      if (payload.delivery?.sent) toast.success("WhatsApp message sent");
      else if (payload.delivery?.error) toast.error(payload.delivery.error);
      else toast.success("WhatsApp message queued");
      setMessageBody(""); setParameters(""); setSelectedTemplate(""); setConfirmOptIn(false); setShowComposer(false); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to send WhatsApp message"); }
    finally { setSending(false); }
  }

  async function createTemplate(event: FormEvent) {
    event.preventDefault();
    if (!activeProjectId) return;
    const variables = [...templateBody.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
    const examples = templateExamples.split(",").map((value) => value.trim()).filter(Boolean);
    if (variables.length && examples.length < Math.max(...variables)) return toast.error("Add one example for every {{number}} variable");
    setBusy(true);
    try {
      const component: Record<string, unknown> = { type: "BODY", text: templateBody };
      if (examples.length) component.example = { body_text: [examples] };
      const response = await fetchWithSession(editingTemplateId ? `/api/whatsapp/templates/${editingTemplateId}` : "/api/whatsapp/templates", {
        method: editingTemplateId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: activeProjectId, name: templateName, language: templateLanguage, category: templateCategory, components: [component] }),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      toast.success(editingTemplateId ? "Template update submitted to Meta" : "Template submitted to Meta for review"); setTemplateName(""); setTemplateBody(""); setTemplateExamples(""); setEditingTemplateId(null); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to create template"); }
    finally { setBusy(false); }
  }

  async function createAutomation(event: FormEvent) {
    event.preventDefault(); if (!activeProjectId) return;
    setBusy(true);
    try {
      const response = await fetchWithSession("/api/whatsapp/automations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: activeProjectId, name: automationName, trigger_activity_type: automationTrigger, whatsapp_template_id: automationTemplate, template_parameters: automationParameters.split(",").map((value) => value.trim()).filter(Boolean) }),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      toast.success("WhatsApp automation enabled"); setAutomationName(""); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to create automation"); }
    finally { setBusy(false); }
  }

  async function toggleAutomation(rule: Automation) {
    const response = await fetchWithSession(`/api/whatsapp/automations/${rule.whatsapp_automation_rule_id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !rule.is_active }),
    });
    if (!response.ok) return toast.error(await getApiError(response));
    await load();
  }

  const rows = useMemo(() => [...messages].sort((a, b) => {
    const left = new Date(a.received_at || a.sent_at || a.created_at).getTime();
    const right = new Date(b.received_at || b.sent_at || b.created_at).getTime();
    return sort === "newest" ? right - left : left - right;
  }), [messages, sort]);

  if (loading) return <div className="space-y-2 p-4">{Array.from({ length: 7 }, (_, index) => <div className="h-14 animate-pulse rounded-lg bg-[#151716]" key={index} />)}</div>;

  return (
    <div className="min-h-[650px] bg-[#090a09] text-[#ecefed]">
      {config?.configured && <Script src="https://connect.facebook.net/en_US/sdk.js" strategy="lazyOnload" onLoad={initializeFacebook} />}
      <div className="flex items-center justify-between border-b border-[#292c2a] px-5 py-3">
        <nav className="flex gap-1" aria-label="WhatsApp workspace">
          {(["inbox", "templates", "automations", "setup"] as Section[]).map((item) => (
            <button className={`rounded-md px-3 py-2 text-[11px] capitalize ${section === item ? "bg-[#222523] text-white" : "text-[#8e938f] hover:text-white"}`} key={item} onClick={() => setSection(item)} type="button">{item}</button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {connection ? <span className="rounded-full border border-[#2d584a] bg-[#153128] px-2.5 py-1 text-[10px] text-[#83c9ad]">{connection.verified_name || connection.display_phone_number || "Connected"}</span> : <span className="text-[10px] text-[#8e938f]">Not connected</span>}
          <button className="rounded-md border border-[#313432] p-2 text-[#9da29f] hover:text-white" onClick={() => void load(true)} type="button" aria-label="Refresh WhatsApp"><RefreshCw className="size-3.5" /></button>
        </div>
      </div>

      {section === "inbox" && (
        <div className="grid min-h-[590px] grid-cols-[minmax(300px,38%)_1fr] max-[850px]:grid-cols-1">
          <div className="border-r border-[#292c2a] p-4 max-[850px]:border-r-0">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Messages</h2><button className="flex items-center gap-1.5 rounded-md bg-[#e7ece9] px-3 py-2 text-[10px] font-semibold text-[#111] disabled:opacity-40" disabled={!connection} onClick={() => setShowComposer(true)} type="button"><Plus className="size-3" /> New message</button></div>
            <div className="max-h-[540px] space-y-1 overflow-y-auto [scrollbar-width:none]">
              {rows.map((message) => (
                <button className="flex w-full gap-3 rounded-lg px-3 py-3 text-left hover:bg-[#171918]" key={message.whatsapp_message_id} onClick={() => { if (message.lead_id) setSelectedLead(message.lead_id); setShowComposer(true); }} type="button">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[#333735] bg-[#1c1f1d] text-[10px]">{person(message).slice(0, 2).toUpperCase()}</span>
                  <span className="min-w-0 flex-1"><span className="flex justify-between gap-2"><strong className="truncate text-[11px]">{person(message)}</strong><time className="text-[9px] text-[#747975]">{time(message.received_at || message.sent_at || message.created_at)}</time></span><span className="mt-1 flex items-center gap-1 text-[10px] text-[#969b97]">{message.direction === "outbound" && <StatusIcon status={message.status} />}<span className="truncate">{message.body || message.template_name || message.message_type}</span></span></span>
                </button>
              ))}
              {!rows.length && <p className="py-16 text-center text-xs text-[#777c78]">No WhatsApp messages yet.</p>}
            </div>
          </div>
          <div className="relative flex items-center justify-center p-8 text-center">
            <div><span className="mx-auto flex size-12 items-center justify-center rounded-xl border border-[#2d3431] bg-[#151816]"><MessageCircle className="size-5 text-[#70b99f]" /></span><h3 className="mt-4 text-sm font-semibold">WhatsApp conversations</h3><p className="mt-2 max-w-sm text-[11px] leading-5 text-[#7e837f]">Reply to customers inside Meta’s 24-hour service window, or use an approved template to restart the conversation.</p></div>
            {showComposer && (
              <form className="absolute inset-x-5 bottom-5 rounded-xl border border-[#363b38] bg-[#151816] p-4 text-left shadow-2xl" onSubmit={sendMessage}>
                <div className="mb-3 flex items-center justify-between"><strong className="text-xs">New WhatsApp message</strong><button onClick={() => setShowComposer(false)} type="button"><X className="size-4 text-[#888e8a]" /></button></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <select className={control} value={selectedLead} onChange={(event) => setSelectedLead(event.target.value)}><option value="">Choose lead</option>{leads.filter((lead) => lead.phone_number).map((lead) => <option key={lead.lead_id} value={lead.lead_id}>{[lead.first_name, lead.last_name].filter(Boolean).join(" ")} · {lead.phone_number}</option>)}</select>
                  <select className={control} value={selectedTemplate} onChange={(event) => setSelectedTemplate(event.target.value)}><option value="">Free-form reply (24h window)</option>{approvedTemplates.map((template) => <option key={template.whatsapp_template_id} value={template.whatsapp_template_id}>{template.name} · {template.language}</option>)}</select>
                </div>
                {selectedTemplate ? <input className={`${control} mt-3`} placeholder="Template values, comma separated" value={parameters} onChange={(event) => setParameters(event.target.value)} /> : <textarea className="mt-3 min-h-24 w-full resize-none rounded-md border border-[#303332] bg-[#0d0f0e] p-3 text-xs outline-none focus:border-[#4d8f78]" placeholder="Write a reply…" value={messageBody} onChange={(event) => setMessageBody(event.target.value)} />}
                <label className="mt-3 flex items-center gap-2 text-[9px] text-[#8e948f]"><input checked={confirmOptIn} className="accent-[#63ae92]" onChange={(event) => setConfirmOptIn(event.target.checked)} type="checkbox" />I confirm this contact explicitly opted in to WhatsApp messages.</label>
                <div className="mt-3 flex items-center justify-between"><p className="text-[9px] text-[#737874]">Outside 24 hours, Meta only allows approved templates.</p><button className="flex items-center gap-2 rounded-md bg-[#e8ecea] px-4 py-2 text-[10px] font-semibold text-[#111] disabled:opacity-50" disabled={sending} type="submit"><Send className="size-3" />{sending ? "Sending…" : "Send"}</button></div>
              </form>
            )}
          </div>
        </div>
      )}

      {section === "templates" && (
        <div className="grid gap-6 p-5 lg:grid-cols-[1fr_390px]">
          <div><div className="mb-4"><h2 className="text-sm font-semibold">Message templates</h2><p className="mt-1 text-[11px] text-[#7f8581]">Templates are reviewed by Meta. Approved templates can start conversations outside the 24-hour window.</p></div><div className="space-y-2">{templates.filter((item) => item.project_id === activeProjectId).map((template) => <div className="rounded-lg border border-[#292d2a] bg-[#121412] p-4" key={template.whatsapp_template_id}><div className="flex items-start justify-between"><div><strong className="text-xs">{template.name}</strong><p className="mt-1 text-[10px] text-[#777d79]">{template.language} · {template.category}</p></div><div className="flex items-center gap-2">{canManage && <button className="text-[9px] text-[#7bb89f] hover:text-[#a6dac5]" onClick={() => { setEditingTemplateId(template.whatsapp_template_id); setTemplateName(template.name); setTemplateLanguage(template.language); setTemplateCategory(template.category); setTemplateBody(template.components?.find((part) => part.type === "BODY")?.text || ""); setTemplateExamples(""); }} type="button">Edit</button>}<span className={`rounded-full px-2 py-1 text-[9px] ${template.status === "APPROVED" ? "bg-[#183a2e] text-[#77c7a8]" : template.status === "REJECTED" ? "bg-[#3b201c] text-[#df8f7c]" : "bg-[#35301d] text-[#d5ba70]"}`}>{template.status}</span></div></div><p className="mt-3 text-[11px] leading-5 text-[#c4c8c5]">{template.components?.find((part) => part.type === "BODY")?.text || "Template content"}</p>{template.rejection_reason && <p className="mt-2 text-[10px] text-[#d78372]">{template.rejection_reason}</p>}</div>)}</div></div>
          <form className="h-fit rounded-xl border border-[#303431] bg-[#131513] p-4" onSubmit={createTemplate}><div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-xs font-semibold"><Plus className="size-3.5" /> {editingTemplateId ? "Edit template" : "Create template"}</h3>{editingTemplateId && <button className="text-[9px] text-[#8f9490]" onClick={() => { setEditingTemplateId(null); setTemplateName(""); setTemplateBody(""); setTemplateExamples(""); }} type="button">Cancel</button>}</div><div className="mt-4 space-y-3"><input className={control} disabled={Boolean(editingTemplateId)} placeholder="template_name" value={templateName} onChange={(event) => setTemplateName(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} /><div className="grid grid-cols-2 gap-2"><select className={control} value={templateCategory} onChange={(event) => setTemplateCategory(event.target.value)}><option>UTILITY</option><option>MARKETING</option><option>AUTHENTICATION</option></select><input className={control} disabled={Boolean(editingTemplateId)} placeholder="en" value={templateLanguage} onChange={(event) => setTemplateLanguage(event.target.value)} /></div><textarea className="min-h-28 w-full resize-none rounded-md border border-[#303332] bg-[#0d0f0e] p-3 text-xs outline-none focus:border-[#4d8f78]" placeholder="Hi {{1}}, your visit at {{2}} is confirmed." value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} /><input className={control} placeholder="Examples: Priya, Aadhya Serene" value={templateExamples} onChange={(event) => setTemplateExamples(event.target.value)} /><button className="h-10 w-full rounded-md bg-[#e8ecea] text-[10px] font-semibold text-[#111] disabled:opacity-40" disabled={!canManage || !connection || busy} type="submit">{editingTemplateId ? "Submit changes to Meta" : "Submit to Meta"}</button></div></form>
        </div>
      )}

      {section === "automations" && (
        <div className="grid gap-6 p-5 lg:grid-cols-[1fr_390px]">
          <div><h2 className="text-sm font-semibold">Event automations</h2><p className="mt-1 text-[11px] text-[#7f8581]">Approved templates are queued when CRM events occur. Failed deliveries retry automatically and remain auditable.</p><div className="mt-4 space-y-2">{automations.filter((rule) => rule.project_id === activeProjectId).map((rule) => <div className="flex items-center justify-between rounded-lg border border-[#292d2a] bg-[#121412] p-4" key={rule.whatsapp_automation_rule_id}><div><strong className="text-xs">{rule.name}</strong><p className="mt-1 text-[10px] text-[#7f8581]">{triggerLabels[rule.trigger_activity_type] || rule.trigger_activity_type} → {rule.template_name}</p></div><button className={`h-6 w-11 rounded-full p-0.5 transition ${rule.is_active ? "bg-[#3e9d7b]" : "bg-[#343835]"}`} onClick={() => void toggleAutomation(rule)} type="button"><span className={`block size-5 rounded-full bg-white transition ${rule.is_active ? "translate-x-5" : ""}`} /></button></div>)}</div></div>
          <form className="h-fit rounded-xl border border-[#303431] bg-[#131513] p-4" onSubmit={createAutomation}><h3 className="flex items-center gap-2 text-xs font-semibold"><Sparkles className="size-3.5" /> New automation</h3><div className="mt-4 space-y-3"><input className={control} placeholder="Automation name" value={automationName} onChange={(event) => setAutomationName(event.target.value)} /><select className={control} value={automationTrigger} onChange={(event) => setAutomationTrigger(event.target.value)}>{triggers.map((trigger) => <option key={trigger} value={trigger}>{triggerLabels[trigger] || trigger}</option>)}</select><select className={control} value={automationTemplate} onChange={(event) => setAutomationTemplate(event.target.value)}><option value="">Choose approved template</option>{approvedTemplates.map((template) => <option key={template.whatsapp_template_id} value={template.whatsapp_template_id}>{template.name}</option>)}</select><input className={control} value={automationParameters} onChange={(event) => setAutomationParameters(event.target.value)} placeholder="{{first_name}}, {{project_name}}" /><p className="text-[9px] leading-4 text-[#717672]">Available fields: first_name, last_name, full_name, project_name, activity_title.</p><button className="h-10 w-full rounded-md bg-[#e8ecea] text-[10px] font-semibold text-[#111] disabled:opacity-40" disabled={!canManage || !automationName || !automationTemplate || busy} type="submit">Enable automation</button></div></form>
        </div>
      )}

      {section === "setup" && (
        <div className="mx-auto max-w-3xl p-7">
          <div className="rounded-xl border border-[#303532] bg-[#121512] p-6">
            <div className="flex items-start justify-between gap-6">
              <div>
                <span className="flex size-10 items-center justify-center rounded-lg border border-[#315344] bg-[#183127]"><Cloud className="size-4 text-[#73b99f]" /></span>
                <h2 className="mt-4 text-base font-semibold">Connect WhatsApp Business</h2>
                <p className="mt-2 max-w-xl text-[11px] leading-5 text-[#8a908c]">Sign in with Meta, choose your Business Portfolio, WhatsApp Business Account and phone number. Sthyra owns the reviewed developer app, so your team does not need to create a separate Meta Developer app.</p>
              </div>
              {connection && <span className="rounded-full bg-[#17362a] px-3 py-1.5 text-[10px] text-[#76c4a5]">Connected</span>}
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-3">
              {["Authorize your Meta business", "Select WABA and phone number", "Templates and webhooks sync here"].map((label, index) => <div className="rounded-lg border border-[#282c29] bg-[#0d0f0e] p-3 text-[10px] text-[#a4a9a5]" key={label}><span className="mb-2 flex size-5 items-center justify-center rounded-full bg-[#242825] text-[9px]">{index + 1}</span>{label}</div>)}
            </div>
            {connection ? (
              <div className="mt-5 rounded-lg border border-[#2b302d] bg-[#0d0f0e] p-4">
                <div className="flex items-center gap-2"><Settings2 className="size-4 text-[#7e8580]" /><strong className="text-xs">{connection.verified_name || "WhatsApp Business"}</strong></div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-[10px]">
                  <div><dt className="text-[#686e6a]">Phone</dt><dd className="mt-1">{connection.display_phone_number || connection.phone_number_id}</dd></div>
                  <div><dt className="text-[#686e6a]">Quality</dt><dd className="mt-1">{connection.quality_rating || "Not reported"}</dd></div>
                  <div><dt className="text-[#686e6a]">Last webhook</dt><dd className="mt-1">{time(connection.last_webhook_at)}</dd></div>
                  <div><dt className="text-[#686e6a]">Status</dt><dd className="mt-1 capitalize">{connection.status}</dd></div>
                </dl>
                {connection.last_error && <p className="mt-3 text-[10px] text-[#d78372]">{connection.last_error}</p>}
                <button className="mt-4 rounded-md border border-[#343a36] px-3 py-2 text-[10px] text-[#b4bab6] hover:border-[#527964] hover:text-white disabled:opacity-40" disabled={!canManage || !config?.configured || busy} onClick={connectMeta} type="button">Reconnect Meta</button>
              </div>
            ) : (
              <button className="mt-5 flex h-11 items-center justify-center gap-2 rounded-md bg-[#e8ecea] px-5 text-[11px] font-semibold text-[#111] disabled:opacity-40" disabled={!canManage || !config?.configured || busy} onClick={connectMeta} type="button"><MessageCircle className="size-4" />{busy ? "Connecting…" : "Connect with Meta"}</button>
            )}
            {!config?.configured && <p className="mt-3 text-[10px] text-[#c79768]">An administrator must add the Meta app ID and Embedded Signup configuration ID before connecting.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
