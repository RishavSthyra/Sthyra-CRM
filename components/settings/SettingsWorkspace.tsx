"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";

type Row = Record<string, unknown>;
type Project = {
  project_id: number;
  project_code: string;
  project_name: string;
  project_status: string;
  project_type: string;
};
type ContextData = {
  company: { company_id: number; company_code: string; company_name: string };
  role_key: string;
  can_view_all_projects: boolean;
  projects: Project[];
};
type Section =
  | "profile"
  | "notifications"
  | "availability"
  | "security"
  | "company"
  | "projects"
  | "people"
  | "sources"
  | "campaigns"
  | "tags"
  | "lead-configuration"
  | "lead-stages"
  | "qualification-fields"
  | "closing-reasons"
  | "queues"
  | "routing-rules"
  | "sla-rules";

const personalSections: { id: Section; label: string; description: string }[] =
  [
    {
      id: "profile",
      label: "Profile",
      description: "Your identity and contact information",
    },
    {
      id: "notifications",
      label: "Notifications",
      description: "Alerts, reminders and digests",
    },
    {
      id: "availability",
      label: "Availability",
      description: "Timezone and working status",
    },
    {
      id: "security",
      label: "Security & sessions",
      description: "Password and signed-in devices",
    },
  ];
const companySections: { id: Section; label: string; description: string }[] = [
  {
    id: "company",
    label: "Company profile",
    description: "Organisation details",
  },
  {
    id: "projects",
    label: "Projects",
    description: "Developments and project workspaces",
  },
  {
    id: "people",
    label: "People & access",
    description: "Users, teams and roles",
  },
  {
    id: "sources",
    label: "Lead sources",
    description: "Where leads originate",
  },
  { id: "campaigns", label: "Campaigns", description: "Acquisition campaigns" },
  { id: "tags", label: "Tags", description: "Shared CRM labels" },
];
const projectSections: { id: Section; label: string; description: string }[] = [
  {
    id: "lead-configuration",
    label: "Lead configuration",
    description: "Defaults and automation",
  },
  {
    id: "lead-stages",
    label: "Lead stages",
    description: "Lifecycle pipeline",
  },
  {
    id: "qualification-fields",
    label: "Qualification fields",
    description: "Project-specific lead data",
  },
  {
    id: "closing-reasons",
    label: "Closing reasons",
    description: "Won and lost outcomes",
  },
  { id: "queues", label: "Queues", description: "Work distribution" },
  {
    id: "routing-rules",
    label: "Routing rules",
    description: "Automated assignment",
  },
  {
    id: "sla-rules",
    label: "SLA rules",
    description: "Response and resolution targets",
  },
];
const allSectionIds = new Set<Section>([
  ...personalSections.map((item) => item.id),
  ...companySections.map((item) => item.id),
  ...projectSections.map((item) => item.id),
]);

const settingsUi = {
  field:
    "flex min-w-0 flex-col gap-2 [&>span]:text-[11px] [&>span]:font-medium [&>span]:tracking-wide [&>span]:text-[#8e9693] [&_input]:h-11 [&_input]:w-full [&_input]:min-w-0 [&_input]:rounded-xl [&_input]:border [&_input]:border-white/10 [&_input]:bg-black/35 [&_input]:px-3.5 [&_input]:text-xs [&_input]:text-[#f0f0f0] [&_input]:outline-none [&_input]:transition [&_input]:placeholder:text-white/25 [&_input]:focus:border-[#4ea98b] [&_input]:focus:ring-2 [&_input]:focus:ring-[#4ea98b]/15 [&_input[type=date]]:[color-scheme:dark] [&_select]:h-11 [&_select]:w-full [&_select]:min-w-0 [&_select]:rounded-xl [&_select]:border [&_select]:border-white/10 [&_select]:bg-[#0b0d0c] [&_select]:px-3.5 [&_select]:text-xs [&_select]:text-[#f0f0f0] [&_select]:outline-none [&_select]:transition [&_select]:focus:border-[#4ea98b] [&_select]:focus:ring-2 [&_select]:focus:ring-[#4ea98b]/15 [&_textarea]:min-h-24 [&_textarea]:w-full [&_textarea]:rounded-xl [&_textarea]:border [&_textarea]:border-white/10 [&_textarea]:bg-black/35 [&_textarea]:p-3.5 [&_textarea]:text-xs [&_textarea]:outline-none [&_textarea]:focus:border-[#4ea98b]",
  card: "overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101311]/95 shadow-[0_16px_50px_rgba(0,0,0,0.18)]",
  cardBody: "p-5 sm:p-6",
  primaryButton:
    "inline-flex h-10 items-center justify-center rounded-xl border border-[#368e75] bg-[linear-gradient(135deg,#2d8a70,#155441)] px-5 text-xs font-semibold text-white shadow-[0_8px_24px_rgba(35,117,95,0.22)] transition hover:-translate-y-px hover:brightness-110 disabled:cursor-wait disabled:opacity-50",
  secondaryButton:
    "inline-flex h-10 w-max items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 text-xs font-medium text-[#e7e7e7] transition hover:border-[#4ea98b]/40 hover:bg-[#4ea98b]/10",
  form: "flex flex-col gap-5",
  grid: "grid grid-cols-2 gap-4 max-[720px]:grid-cols-1",
  compactGrid: "grid max-w-[680px] grid-cols-2 gap-4 max-[720px]:grid-cols-1",
  actions: "flex items-center justify-end gap-3",
  stack: "flex flex-col gap-4",
  tableAction:
    "border-0 bg-transparent p-1 text-[10px] font-semibold text-[#65c9a7] transition hover:text-[#a0ead1] disabled:cursor-wait disabled:opacity-50",
  status:
    "inline-flex rounded-full bg-white/[0.07] px-2.5 py-1 text-[9px] font-semibold text-[#aaa]",
  statusOn: "bg-[#17392f] text-[#75d0b1]",
} as const;

function value(row: Row, key: string) {
  const item = row[key];
  return item === null || item === undefined ? "—" : String(item);
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className={settingsUi.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Card({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className={settingsUi.card}>
      <header className="border-b border-white/[0.07] bg-white/[0.025] px-5 py-4 sm:px-6">
        <div>
          <h2 className="font-[var(--font-bricolage)] text-sm font-semibold text-[#f5f5f5]">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-[11px] leading-relaxed text-[#777f7c]">
              {description}
            </p>
          )}
        </div>
      </header>
      <div className={settingsUi.cardBody}>{children}</div>
    </section>
  );
}

function SaveButton({
  busy,
  children = "Save changes",
}: {
  busy: boolean;
  children?: ReactNode;
}) {
  return (
    <button className={settingsUi.primaryButton} disabled={busy} type="submit">
      {busy ? "Saving…" : children}
    </button>
  );
}

function Toggle({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description?: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="relative flex min-h-[62px] cursor-pointer items-center gap-3 border-b border-white/[0.07] py-2.5 last:border-0">
      <span className="flex flex-1 flex-col gap-1 px-0.5">
        <strong className="text-xs font-medium text-[#e7e7e7]">{label}</strong>
        {description && (
          <small className="text-[10px] leading-relaxed text-[#737b78]">
            {description}
          </small>
        )}
      </span>
      <input
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <i
        aria-hidden
        className="relative h-[22px] w-10 shrink-0 rounded-full border border-white/10 bg-[#2c302e] transition before:absolute before:top-[3px] before:left-[3px] before:size-3.5 before:rounded-full before:bg-[#c9cecc] before:transition-transform peer-checked:border-[#4ea98b] peer-checked:bg-[#236b57] peer-checked:before:translate-x-[18px] peer-checked:before:bg-white"
      />
    </label>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-36 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/15 p-6 text-center text-xs text-[#686f6c]">
      {children}
    </div>
  );
}

function ListTable({
  columns,
  rows,
}: {
  columns: { key: string; label: string; render?: (row: Row) => ReactNode }[];
  rows: Row[];
}) {
  if (!rows.length) return <Empty>No configuration has been added yet.</Empty>;
  return (
    <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <table className="w-full min-w-[600px] border-collapse text-left [&_td]:border-b [&_td]:border-white/[0.07] [&_td]:px-3 [&_td]:py-3.5 [&_td]:text-[10px] [&_td]:text-[#c4c4c4] [&_th]:border-b [&_th]:border-white/[0.07] [&_th]:px-3 [&_th]:py-3 [&_th]:text-[9px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-[0.12em] [&_th]:text-[#68706d]">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={String(
                row.id ??
                  row.user_id ??
                  row.team_id ??
                  row.role_id ??
                  row.source_id ??
                  row.campaign_id ??
                  row.tag_id ??
                  row.queue_id ??
                  row.rule_id ??
                  row.sla_rule_id ??
                  index,
              )}
            >
              {columns.map((column) => (
                <td key={column.key}>
                  {column.render ? column.render(row) : value(row, column.key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SettingsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSection = searchParams.get("section") as Section | null;
  const [section, setSection] = useState<Section>(
    requestedSection && allSectionIds.has(requestedSection)
      ? requestedSection
      : "profile",
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [context, setContext] = useState<ContextData | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    null,
  );
  const [user, setUser] = useState<Row>({});
  const [preferences, setPreferences] = useState<Row>({});
  const [availability, setAvailability] = useState<Row>({});
  const [sessions, setSessions] = useState<Row[]>([]);
  const [company, setCompany] = useState<Row>({});
  const [projects, setProjects] = useState<Row[]>([]);
  const [regions, setRegions] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [teams, setTeams] = useState<Row[]>([]);
  const [roles, setRoles] = useState<Row[]>([]);
  const [sources, setSources] = useState<Row[]>([]);
  const [campaigns, setCampaigns] = useState<Row[]>([]);
  const [tags, setTags] = useState<Row[]>([]);
  const [leadConfiguration, setLeadConfiguration] = useState<Row>({});
  const [stages, setStages] = useState<Row[]>([]);
  const [qualificationFields, setQualificationFields] = useState<Row[]>([]);
  const [closingReasons, setClosingReasons] = useState<Row[]>([]);
  const [queues, setQueues] = useState<Row[]>([]);
  const [routingRules, setRoutingRules] = useState<Row[]>([]);
  const [slaRules, setSlaRules] = useState<Row[]>([]);

  const api = useCallback(
    async (url: string, init?: RequestInit) => {
      const response = await fetchWithSession(url, {
        cache: "no-store",
        ...init,
      });
      if (response.status === 401) {
        router.replace("/login");
        throw new Error("Authentication required");
      }
      if (!response.ok) throw new Error(await getApiError(response));
      return (await response.json()) as Record<string, unknown>;
    },
    [router],
  );

  const loadProject = useCallback(
    async (projectId: number) => {
      const [
        configurationData,
        stagesData,
        fieldsData,
        reasonsData,
        queueData,
        routingData,
        slaData,
      ] = await Promise.all([
        api(`/api/projects/${projectId}/lead-configuration`),
        api(`/api/projects/${projectId}/lead-stages`),
        api(`/api/projects/${projectId}/qualification-fields`),
        api(`/api/projects/${projectId}/closing-reasons`),
        api(`/api/queues?project_id=${projectId}&limit=100`),
        api(`/api/routing-rules?project_id=${projectId}&limit=100`),
        api(`/api/sla-rules?project_id=${projectId}&limit=100`),
      ]);
      setLeadConfiguration((configurationData.configuration as Row) ?? {});
      setStages((stagesData.stages as Row[]) ?? []);
      setQualificationFields((fieldsData.fields as Row[]) ?? []);
      setClosingReasons((reasonsData.reasons as Row[]) ?? []);
      setQueues((queueData.queues as Row[]) ?? []);
      setRoutingRules((routingData.rules as Row[]) ?? []);
      setSlaRules((slaData.rules as Row[]) ?? []);
    },
    [api],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [meData, contextData, preferenceData, sessionData] =
        await Promise.all([
          api("/api/auth/me"),
          api("/api/auth/project-context"),
          api("/api/preferences"),
          api("/api/auth/sessions"),
        ]);
      const nextContext = contextData as unknown as ContextData;
      const nextUser = (meData.user as Row) ?? {};
      setUser(nextUser);
      setContext(nextContext);
      setPreferences((preferenceData.preferences as Row) ?? {});
      setSessions((sessionData.sessions as Row[]) ?? []);
      const requestedProject = Number(
        new URLSearchParams(window.location.search).get("project"),
      );
      const storedProject = Number(
        window.localStorage.getItem("sthyra-project-id"),
      );
      const preferredProject = Number.isFinite(requestedProject)
        ? requestedProject
        : storedProject;
      const projectId = nextContext.projects.some(
        (project) => project.project_id === preferredProject,
      )
        ? preferredProject
        : (nextContext.projects[0]?.project_id ?? null);
      setSelectedProjectId(projectId);
      const companyId = nextContext.company.company_id;
      const baseRequests: Promise<Record<string, unknown>>[] = [
        api(`/api/companies/${companyId}`),
        api(`/api/users/${String(nextUser.user_id)}/availability`),
      ];
      if (nextContext.can_view_all_projects) {
        baseRequests.push(
          api("/api/users?limit=100"),
          api(
            `/api/teams?companyId=${companyId}&limit=100&includeInactive=true`,
          ),
          api("/api/roles?limit=100&includeInactive=true"),
          api("/api/lead-sources?limit=100"),
          api("/api/campaigns?limit=100"),
          api("/api/tags?limit=100"),
          api(
            `/api/projects?companyCode=${encodeURIComponent(nextContext.company.company_code)}&includeInactive=true&limit=100`,
          ),
          api("/api/regions?includeInactive=true&limit=100"),
        );
      }
      const base = await Promise.all(baseRequests);
      setCompany((base[0].company as Row) ?? {});
      setAvailability((base[1].availability as Row) ?? {});
      if (nextContext.can_view_all_projects) {
        setUsers((base[2].users as Row[]) ?? []);
        setTeams((base[3].teams as Row[]) ?? []);
        setRoles((base[4].roles as Row[]) ?? []);
        setSources((base[5].sources as Row[]) ?? []);
        setCampaigns((base[6].campaigns as Row[]) ?? []);
        setTags((base[7].tags as Row[]) ?? []);
        setProjects((base[8].projects as Row[]) ?? []);
        setRegions((base[9].regions as Row[]) ?? []);
      }
      if (projectId) await loadProject(projectId);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load settings",
      );
    } finally {
      setLoading(false);
    }
  }, [api, loadProject]);

  useEffect(() => {
    const task = window.setTimeout(() => void loadAll(), 0);
    return () => window.clearTimeout(task);
  }, [loadAll]);

  const chooseSection = (next: Section) => {
    setSection(next);
    const params = new URLSearchParams(window.location.search);
    params.set("section", next);
    if (selectedProjectId) params.set("project", String(selectedProjectId));
    window.history.pushState(null, "", `/settings?${params.toString()}`);
  };

  const changeProject = async (projectId: number) => {
    setSelectedProjectId(projectId);
    window.localStorage.setItem("sthyra-project-id", String(projectId));
    const params = new URLSearchParams(window.location.search);
    params.set("section", section);
    params.set("project", String(projectId));
    window.history.replaceState(null, "", `/settings?${params.toString()}`);
    setBusy(true);
    try {
      await loadProject(projectId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to load project settings",
      );
    } finally {
      setBusy(false);
    }
  };

  const save = async (
    url: string,
    method: "PATCH" | "PUT" | "POST",
    payload: unknown,
    success: string,
    after?: () => Promise<void> | void,
  ) => {
    setBusy(true);
    try {
      const result = await api(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast.success((result.message as string) || success);
      if (after) await after();
      return result;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save changes",
      );
      return null;
    } finally {
      setBusy(false);
    }
  };

  const selectedProject =
    context?.projects.find(
      (project) => project.project_id === selectedProjectId,
    ) ?? null;
  const currentDefinition = [
    ...personalSections,
    ...companySections,
    ...projectSections,
  ].find((item) => item.id === section);
  const admin = context?.can_view_all_projects === true;

  const navGroup = (title: string, items: typeof personalSections) => (
    <div className="flex flex-col gap-1.5 border-t border-white/[0.07] pt-5 first:border-0 first:pt-0">
      <span className="mb-1 px-3 text-[9px] font-bold tracking-[0.16em] text-[#5f6865] uppercase">
        {title}
      </span>
      {items.map((item) => (
        <button
          className={`group relative flex min-h-[58px] w-full flex-col items-start justify-center overflow-hidden rounded-xl border px-3.5 text-left transition ${
            section === item.id
              ? "border-[#4ea98b]/35 bg-[linear-gradient(110deg,rgba(45,125,101,0.2),rgba(255,255,255,0.04))] shadow-[inset_3px_0_0_#4ea98b]"
              : "border-transparent bg-transparent hover:border-white/[0.06] hover:bg-white/[0.035]"
          }`}
          key={item.id}
          onClick={() => chooseSection(item.id)}
          type="button"
        >
          <strong
            className={`text-xs font-semibold transition ${section === item.id ? "text-[#eef8f4]" : "text-[#b7bdbb] group-hover:text-white"}`}
          >
            {item.label}
          </strong>
          <small className="mt-1 text-[9px] leading-tight text-[#666e6b]">
            {item.description}
          </small>
        </button>
      ))}
    </div>
  );

  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_85%_0%,rgba(29,103,82,0.12),transparent_28%),#000] text-[#f5f5f5]">
      <DashboardSidebar />
      <section className="ml-[100px] min-h-dvh py-8 pr-8 pb-12 transition-[margin] duration-200 peer-hover:ml-[250px] max-[900px]:ml-[250px] max-[900px]:py-6 max-[900px]:pr-5 max-[900px]:pb-10 max-[560px]:ml-0 max-[560px]:px-3 max-[560px]:pt-24 max-[560px]:pb-8">
        <div className="mx-auto max-w-[1720px]">
          <div className="flex items-end justify-between gap-6 max-[720px]:items-start max-[720px]:flex-col">
            <div>
              <span className="text-xs text-[#5b5b5b]">
                Workspace / Settings
              </span>
              <h1 className="mt-3 font-[var(--font-bricolage)] text-[clamp(32px,3vw,44px)] leading-[1.1]">
                Settings
              </h1>
              <p className="mt-2 text-sm text-[#9ba19f]">
                Configure your account, company and project operations.
              </p>
            </div>
            {context && (
              <div className="flex items-center gap-3 rounded-full border border-[#2e7d65]/45 bg-[#153a2f]/45 px-4 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
                <span className="text-[10px] text-[#9fc7ba]">
                  {context.company.company_name}
                </span>
                <strong className="border-l border-[#4ea98b]/25 pl-3 text-[9px] font-bold tracking-[0.12em] text-[#70c5a9] uppercase">
                  {context.role_key.replaceAll("_", " ")}
                </strong>
              </div>
            )}
          </div>
          <div className="mt-8 grid grid-cols-[286px_minmax(0,1fr)] items-start gap-5 max-[1050px]:grid-cols-[240px_minmax(0,1fr)] max-[760px]:grid-cols-1">
            <aside className="sticky top-6 flex max-h-[calc(100dvh-48px)] flex-col gap-5 overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0d100f]/95 p-3.5 shadow-[0_18px_55px_rgba(0,0,0,0.24)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-[760px]:static max-[760px]:grid max-[760px]:max-h-[360px] max-[760px]:grid-cols-2 max-[560px]:grid-cols-1">
              {navGroup("Personal", personalSections)}
              {admin && navGroup("Company", companySections)}
              <div className="flex flex-col gap-2 border-t border-white/[0.07] pt-5">
                <span className="px-3 text-[9px] font-bold tracking-[0.16em] text-[#5f6865] uppercase">
                  Project settings
                </span>
                <select
                  className="h-11 w-full rounded-xl border border-[#3a443f] bg-[#111513] px-3 text-[11px] text-[#dfe4e2] outline-none transition focus:border-[#4ea98b]"
                  disabled={!context?.projects.length || busy}
                  onChange={(event) =>
                    void changeProject(Number(event.target.value))
                  }
                  value={selectedProjectId ?? ""}
                >
                  {!context?.projects.length && (
                    <option value="">No projects available</option>
                  )}
                  {context?.projects.map((project) => (
                    <option key={project.project_id} value={project.project_id}>
                      {project.project_name}
                    </option>
                  ))}
                </select>
              </div>
              {selectedProject && navGroup("Current project", projectSections)}
            </aside>
            <section className="min-w-0 overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#090b0a]/90 shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
              <header className="flex min-h-[126px] items-center justify-between gap-6 border-b border-white/[0.08] bg-[linear-gradient(120deg,rgba(37,112,89,0.13),rgba(255,255,255,0.025)_55%,transparent)] px-7 py-6 max-[560px]:px-5">
                <div>
                  <span className="text-[9px] font-semibold tracking-[0.14em] text-[#4ea98b] uppercase">
                    {section.startsWith("lead-") ||
                    projectSections.some((item) => item.id === section)
                      ? selectedProject?.project_name
                      : section === "profile" ||
                          personalSections.some((item) => item.id === section)
                        ? "Personal"
                        : context?.company.company_name}
                  </span>
                  <h2 className="mt-2 font-[var(--font-bricolage)] text-2xl font-medium tracking-[-0.01em] text-[#f1f4f3]">
                    {currentDefinition?.label}
                  </h2>
                  <p className="mt-1 text-[11px] text-[#7d8582]">
                    {currentDefinition?.description}
                  </p>
                </div>
                {busy && (
                  <span className="flex items-center gap-2 rounded-full border border-[#4ea98b]/20 bg-[#16392f]/60 px-3 py-1.5 text-[9px] font-semibold text-[#75d0b1] before:size-1.5 before:animate-pulse before:rounded-full before:bg-[#75d0b1]">
                    Saving
                  </span>
                )}
              </header>
              {loading ? (
                <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-xs text-[#747b79]">
                  <i className="size-6 animate-spin rounded-full border-2 border-white/10 border-t-[#4ea98b]" />
                  <span>Loading workspace settings…</span>
                </div>
              ) : (
                <div className="p-4 sm:p-5">
                  <SettingsPanel
                    admin={admin}
                    api={api}
                    availability={availability}
                    busy={busy}
                    campaigns={campaigns}
                    closingReasons={closingReasons}
                    company={company}
                    context={context}
                    leadConfiguration={leadConfiguration}
                    loadAll={loadAll}
                    loadProject={loadProject}
                    preferences={preferences}
                    projects={projects}
                    qualificationFields={qualificationFields}
                    queues={queues}
                    roles={roles}
                    regions={regions}
                    routingRules={routingRules}
                    save={save}
                    section={section}
                    selectedProject={selectedProject}
                    sessions={sessions}
                    setAvailability={setAvailability}
                    setClosingReasons={setClosingReasons}
                    setLeadConfiguration={setLeadConfiguration}
                    setPreferences={setPreferences}
                    setQualificationFields={setQualificationFields}
                    setSessions={setSessions}
                    setStages={setStages}
                    setUser={setUser}
                    slaRules={slaRules}
                    sources={sources}
                    stages={stages}
                    tags={tags}
                    teams={teams}
                    user={user}
                    users={users}
                  />
                </div>
              )}
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}

type PanelProps = {
  admin: boolean;
  api: (url: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  availability: Row;
  busy: boolean;
  campaigns: Row[];
  closingReasons: Row[];
  company: Row;
  context: ContextData | null;
  leadConfiguration: Row;
  loadAll: () => Promise<void>;
  loadProject: (projectId: number) => Promise<void>;
  preferences: Row;
  projects: Row[];
  qualificationFields: Row[];
  queues: Row[];
  roles: Row[];
  regions: Row[];
  routingRules: Row[];
  save: (
    url: string,
    method: "PATCH" | "PUT" | "POST",
    payload: unknown,
    success: string,
    after?: () => Promise<void> | void,
  ) => Promise<Record<string, unknown> | null>;
  section: Section;
  selectedProject: Project | null;
  sessions: Row[];
  setAvailability: (row: Row) => void;
  setClosingReasons: (rows: Row[]) => void;
  setLeadConfiguration: (row: Row) => void;
  setPreferences: (row: Row) => void;
  setQualificationFields: (rows: Row[]) => void;
  setSessions: (rows: Row[]) => void;
  setStages: (rows: Row[]) => void;
  setUser: (row: Row) => void;
  slaRules: Row[];
  sources: Row[];
  stages: Row[];
  tags: Row[];
  teams: Row[];
  user: Row;
  users: Row[];
};

function SettingsPanel(props: PanelProps) {
  const projectId = props.selectedProject?.project_id;
  if (props.section === "profile") return <ProfilePanel {...props} />;
  if (props.section === "notifications")
    return <NotificationPanel {...props} />;
  if (props.section === "availability") return <AvailabilityPanel {...props} />;
  if (props.section === "security") return <SecurityPanel {...props} />;
  if (props.section === "company") return <CompanyPanel {...props} />;
  if (props.section === "projects") return <ProjectsPanel {...props} />;
  if (props.section === "people") return <PeoplePanel {...props} />;
  if (props.section === "sources")
    return <CatalogPanel {...props} kind="sources" rows={props.sources} />;
  if (props.section === "campaigns")
    return <CatalogPanel {...props} kind="campaigns" rows={props.campaigns} />;
  if (props.section === "tags")
    return <CatalogPanel {...props} kind="tags" rows={props.tags} />;
  if (!projectId)
    return <Empty>Select a project to configure this section.</Empty>;
  if (props.section === "lead-configuration")
    return <LeadConfigurationPanel {...props} projectId={projectId} />;
  if (props.section === "lead-stages")
    return <StagesPanel {...props} projectId={projectId} />;
  if (props.section === "qualification-fields")
    return <QualificationPanel {...props} projectId={projectId} />;
  if (props.section === "closing-reasons")
    return <ClosingReasonsPanel {...props} projectId={projectId} />;
  if (props.section === "queues")
    return (
      <AutomationPanel
        {...props}
        kind="queues"
        projectId={projectId}
        rows={props.queues}
      />
    );
  if (props.section === "routing-rules")
    return (
      <AutomationPanel
        {...props}
        kind="routing-rules"
        projectId={projectId}
        rows={props.routingRules}
      />
    );
  return (
    <AutomationPanel
      {...props}
      kind="sla-rules"
      projectId={projectId}
      rows={props.slaRules}
    />
  );
}

function ProfilePanel(props: PanelProps) {
  const [form, setForm] = useState<Row>(props.user);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await props.save(
      "/api/auth/me",
      "PATCH",
      {
        username: form.username,
        first_name: form.first_name,
        last_name: form.last_name || null,
        email: form.email,
        phone: form.phone || null,
      },
      "Profile updated",
    );
    if (result?.user) props.setUser(result.user as Row);
  };
  return (
    <Card
      title="Personal details"
      description="This information identifies you throughout the workspace."
    >
      <form className={settingsUi.form} onSubmit={submit}>
        <div className={settingsUi.grid}>
          <Field label="First name">
            <input
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              required
              value={value(form, "first_name").replace("—", "")}
            />
          </Field>
          <Field label="Last name">
            <input
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
              value={value(form, "last_name").replace("—", "")}
            />
          </Field>
          <Field label="Username">
            <input
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
              value={value(form, "username").replace("—", "")}
            />
          </Field>
          <Field label="Email">
            <input
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              type="email"
              value={value(form, "email").replace("—", "")}
            />
          </Field>
          <Field label="Phone">
            <input
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              value={value(form, "phone").replace("—", "")}
            />
          </Field>
        </div>
        <div className={settingsUi.actions}>
          <SaveButton busy={props.busy} />
        </div>
      </form>
    </Card>
  );
}

function NotificationPanel(props: PanelProps) {
  const [form, setForm] = useState<Row>(props.preferences);
  const toggle = (key: string) => (checked: boolean) =>
    setForm({ ...form, [key]: checked });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      compact_mode: Boolean(form.compact_mode),
      email_notifications: Boolean(form.email_notifications),
      push_notifications: Boolean(form.push_notifications),
      lead_assignment_notifications: Boolean(
        form.lead_assignment_notifications,
      ),
      task_reminders: Boolean(form.task_reminders),
      appointment_reminders: Boolean(form.appointment_reminders),
      digest_frequency: form.digest_frequency,
      default_landing_page: form.default_landing_page,
    };
    const result = await props.save(
      "/api/preferences",
      "PATCH",
      payload,
      "Preferences updated",
    );
    if (result?.preferences) props.setPreferences(result.preferences as Row);
  };
  return (
    <form className={settingsUi.stack} onSubmit={submit}>
      <Card
        title="Notification channels"
        description="Choose where operational alerts reach you."
      >
        <Toggle
          checked={Boolean(form.email_notifications)}
          description="Receive important CRM updates by email."
          label="Email notifications"
          onChange={toggle("email_notifications")}
        />
        <Toggle
          checked={Boolean(form.push_notifications)}
          description="Show real-time alerts while you work."
          label="In-app notifications"
          onChange={toggle("push_notifications")}
        />
      </Card>
      <Card title="Operational reminders">
        <Toggle
          checked={Boolean(form.lead_assignment_notifications)}
          label="New lead assignments"
          onChange={toggle("lead_assignment_notifications")}
        />
        <Toggle
          checked={Boolean(form.task_reminders)}
          label="Task reminders"
          onChange={toggle("task_reminders")}
        />
        <Toggle
          checked={Boolean(form.appointment_reminders)}
          label="Appointment reminders"
          onChange={toggle("appointment_reminders")}
        />
        <div className={settingsUi.compactGrid}>
          <Field label="Summary digest">
            <select
              onChange={(e) =>
                setForm({ ...form, digest_frequency: e.target.value })
              }
              value={String(form.digest_frequency ?? "daily")}
            >
              <option value="never">Never</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </Field>
          <Field label="Default landing page">
            <select
              onChange={(e) =>
                setForm({ ...form, default_landing_page: e.target.value })
              }
              value={String(form.default_landing_page ?? "dashboard")}
            >
              <option value="dashboard">Dashboard</option>
              <option value="leads">Leads</option>
              <option value="activity">Activity</option>
              <option value="calendar">Calendar</option>
            </select>
          </Field>
        </div>
      </Card>
      <div className={settingsUi.actions}>
        <SaveButton busy={props.busy} />
      </div>
    </form>
  );
}

function AvailabilityPanel(props: PanelProps) {
  const [form, setForm] = useState<Row>(props.availability);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await props.save(
      `/api/users/${String(props.user.user_id)}/availability`,
      "PATCH",
      { timezone: form.timezone, is_available: Boolean(form.is_available) },
      "Availability updated",
    );
    if (result?.availability) props.setAvailability(result.availability as Row);
  };
  return (
    <Card
      title="Working availability"
      description="Assignment and scheduling tools use this status."
    >
      <form className={settingsUi.form} onSubmit={submit}>
        <Toggle
          checked={form.is_available !== false}
          description="Allow queues and routing rules to assign work to you."
          label="Available for assignments"
          onChange={(checked) => setForm({ ...form, is_available: checked })}
        />
        <div className={settingsUi.compactGrid}>
          <Field label="Timezone">
            <select
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              value={String(form.timezone ?? "Asia/Kolkata")}
            >
              <option value="Asia/Kolkata">Asia/Kolkata</option>
              <option value="Asia/Dubai">Asia/Dubai</option>
              <option value="Europe/London">Europe/London</option>
              <option value="America/New_York">America/New_York</option>
              <option value="America/Los_Angeles">America/Los_Angeles</option>
            </select>
          </Field>
        </div>
        <div className={settingsUi.actions}>
          <SaveButton busy={props.busy} />
        </div>
      </form>
    </Card>
  );
}

function SecurityPanel(props: PanelProps) {
  const router = useRouter();
  const [passwords, setPasswords] = useState({
    current: "",
    next: "",
    confirmation: "",
  });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (passwords.next !== passwords.confirmation) {
      toast.error("New passwords do not match");
      return;
    }
    setPasswordBusy(true);
    try {
      const response = await fetchWithSession("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: passwords.current,
          new_password: passwords.next,
        }),
      });
      if (!response.ok) throw new Error(await getApiError(response));
      toast.success("Password changed. Please sign in again.");
      router.replace("/login");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to change password",
      );
    } finally {
      setPasswordBusy(false);
    }
  };
  const revokeWithDelete = async (sessionId: string, current: boolean) => {
    try {
      const response = await fetchWithSession(
        `/api/auth/sessions/${sessionId}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(await getApiError(response));
      toast.success("Session revoked");
      if (current) router.replace("/login");
      else
        props.setSessions(
          props.sessions.filter((session) => session.session_id !== sessionId),
        );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to revoke session",
      );
    }
  };
  return (
    <div className={settingsUi.stack}>
      <Card title="Password">
        <form className={settingsUi.form} onSubmit={changePassword}>
          <p className="max-w-[680px] text-[11px] leading-relaxed text-[#858d8a]">
            Changing your password signs out every active device, including this
            one.
          </p>
          <div className={settingsUi.grid}>
            <Field label="Current password">
              <input
                autoComplete="current-password"
                onChange={(event) =>
                  setPasswords({ ...passwords, current: event.target.value })
                }
                required
                type="password"
                value={passwords.current}
              />
            </Field>
            <Field label="New password">
              <input
                autoComplete="new-password"
                minLength={8}
                onChange={(event) =>
                  setPasswords({ ...passwords, next: event.target.value })
                }
                required
                type="password"
                value={passwords.next}
              />
            </Field>
            <Field label="Confirm new password">
              <input
                autoComplete="new-password"
                minLength={8}
                onChange={(event) =>
                  setPasswords({
                    ...passwords,
                    confirmation: event.target.value,
                  })
                }
                required
                type="password"
                value={passwords.confirmation}
              />
            </Field>
          </div>
          <div className={settingsUi.actions}>
            <SaveButton busy={passwordBusy}>Change password</SaveButton>
          </div>
        </form>
      </Card>
      <Card
        title="Active sessions"
        description="Devices currently signed in to your account."
      >
        <div className="flex flex-col [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:gap-4 [&>div]:border-b [&>div]:border-white/[0.07] [&>div]:py-3.5 [&>div:first-child]:pt-0 [&>div:last-child]:border-0 [&>div:last-child]:pb-0 [&_small]:mt-1 [&_small]:block [&_small]:text-[9px] [&_small]:text-[#727a77] [&_span]:flex [&_span]:flex-col [&_strong]:text-[11px] [&_button]:rounded-lg [&_button]:border [&_button]:border-white/10 [&_button]:bg-white/[0.04] [&_button]:px-3 [&_button]:py-2 [&_button]:text-[10px] [&_button]:text-[#c9cecc] [&_button]:transition [&_button]:hover:border-red-400/30 [&_button]:hover:text-red-300">
          {props.sessions.map((session) => (
            <div key={String(session.session_id)}>
              <span>
                <strong>
                  {session.is_current
                    ? "This device"
                    : value(session, "user_agent")}
                </strong>
                <small>
                  {value(session, "ip_address")} · Last used{" "}
                  {new Date(String(session.last_used_at)).toLocaleString()}
                </small>
              </span>
              <button
                onClick={() =>
                  void revokeWithDelete(
                    String(session.session_id),
                    Boolean(session.is_current),
                  )
                }
                type="button"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function CompanyPanel(props: PanelProps) {
  const [form, setForm] = useState<Row>(props.company);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      company_name: form.company_name,
      company_legal_name: form.company_legal_name || null,
      established_on: form.established_on || null,
      company_phone_number: form.company_phone_number || null,
      company_contact_email: form.company_contact_email || null,
    };
    await props.save(
      `/api/companies/${String(props.context?.company.company_id)}`,
      "PATCH",
      payload,
      "Company profile updated",
      props.loadAll,
    );
  };
  return (
    <Card
      title="Company profile"
      description="Shared organisation information shown across the workspace."
    >
      <form className={settingsUi.form} onSubmit={submit}>
        <div className={settingsUi.grid}>
          <Field label="Company name">
            <input
              required
              value={String(form.company_name ?? "")}
              onChange={(e) =>
                setForm({ ...form, company_name: e.target.value })
              }
            />
          </Field>
          <Field label="Legal name">
            <input
              value={String(form.company_legal_name ?? "")}
              onChange={(e) =>
                setForm({ ...form, company_legal_name: e.target.value })
              }
            />
          </Field>
          <Field label="Contact email">
            <input
              type="email"
              value={String(form.company_contact_email ?? "")}
              onChange={(e) =>
                setForm({ ...form, company_contact_email: e.target.value })
              }
            />
          </Field>
          <Field label="Phone">
            <input
              value={String(form.company_phone_number ?? "")}
              onChange={(e) =>
                setForm({ ...form, company_phone_number: e.target.value })
              }
            />
          </Field>
          <Field label="Established on">
            <input
              type="date"
              value={String(form.established_on ?? "").slice(0, 10)}
              onChange={(e) =>
                setForm({ ...form, established_on: e.target.value })
              }
            />
          </Field>
        </div>
        <div className={settingsUi.actions}>
          <SaveButton busy={props.busy} />
        </div>
      </form>
    </Card>
  );
}

function ProjectsPanel(props: PanelProps) {
  const [form, setForm] = useState<Row>({
    project_status: "planning",
    project_type: "residential",
  });
  const create = async (event: FormEvent) => {
    event.preventDefault();
    const result = await props.save(
      "/api/projects",
      "POST",
      {
        company_code: props.context?.company.company_code,
        region_code: form.region_code,
        project_code: form.project_code,
        project_name: form.project_name,
        project_status: form.project_status,
        project_type: form.project_type,
        project_acres: form.project_acres ? Number(form.project_acres) : null,
        start_date: form.start_date || null,
        expected_completion_date: form.expected_completion_date || null,
        address: form.address || null,
        postal_code: form.postal_code || null,
        rera_number: form.rera_number || null,
        is_active: true,
      },
      "Project created",
      props.loadAll,
    );
    if (result)
      setForm({ project_status: "planning", project_type: "residential" });
  };
  const toggleProject = (row: Row) =>
    void props.save(
      `/api/projects/${String(row.project_id)}/${row.is_active ? "deactivate" : "activate"}`,
      "POST",
      {},
      `Project ${row.is_active ? "deactivated" : "activated"}`,
      props.loadAll,
    );
  return (
    <div className={settingsUi.stack}>
      <Card
        title="Project workspaces"
        description="Each project keeps its own stages, fields, queues and SLA configuration."
      >
        <ListTable
          rows={props.projects}
          columns={[
            { key: "project_name", label: "Project" },
            { key: "project_code", label: "Code" },
            { key: "region_name", label: "Region" },
            { key: "project_status", label: "Status" },
            {
              key: "is_active",
              label: "Access",
              render: (row) => (
                <span
                  className={`${settingsUi.status} ${row.is_active ? settingsUi.statusOn : ""}`}
                >
                  {row.is_active ? "Active" : "Inactive"}
                </span>
              ),
            },
            {
              key: "action",
              label: "",
              render: (row) => (
                <button
                  className={settingsUi.tableAction}
                  disabled={props.busy}
                  onClick={() => toggleProject(row)}
                  type="button"
                >
                  {row.is_active ? "Deactivate" : "Activate"}
                </button>
              ),
            },
          ]}
        />
      </Card>
      <Card
        title="Add project"
        description="A complete default lead lifecycle is created automatically."
      >
        <form className={settingsUi.form} onSubmit={create}>
          <div className={settingsUi.grid}>
            <Field label="Project name">
              <input
                onChange={(event) =>
                  setForm({ ...form, project_name: event.target.value })
                }
                required
                value={String(form.project_name ?? "")}
              />
            </Field>
            <Field label="Project code">
              <input
                onChange={(event) =>
                  setForm({
                    ...form,
                    project_code: event.target.value
                      .toUpperCase()
                      .replaceAll(" ", "_"),
                  })
                }
                required
                value={String(form.project_code ?? "")}
              />
            </Field>
            <Field label="Region">
              <select
                onChange={(event) =>
                  setForm({ ...form, region_code: event.target.value })
                }
                required
                value={String(form.region_code ?? "")}
              >
                <option value="">Select region</option>
                {props.regions
                  .filter((region) => region.is_active !== false)
                  .map((region) => (
                    <option
                      key={String(region.region_id)}
                      value={String(region.region_code)}
                    >
                      {value(region, "region_name")}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Project type">
              <select
                onChange={(event) =>
                  setForm({ ...form, project_type: event.target.value })
                }
                value={String(form.project_type ?? "residential")}
              >
                <option value="residential">Residential</option>
                <option value="commercial">Commercial</option>
                <option value="mix_use">Mixed use</option>
              </select>
            </Field>
            <Field label="Project status">
              <select
                onChange={(event) =>
                  setForm({ ...form, project_status: event.target.value })
                }
                value={String(form.project_status ?? "planning")}
              >
                <option value="planning">Planning</option>
                <option value="launched">Launched</option>
                <option value="under_construction">Under construction</option>
                <option value="completed">Completed</option>
                <option value="on_hold">On hold</option>
              </select>
            </Field>
            <Field label="Area (acres)">
              <input
                min="0.01"
                onChange={(event) =>
                  setForm({ ...form, project_acres: event.target.value })
                }
                step="0.01"
                type="number"
                value={String(form.project_acres ?? "")}
              />
            </Field>
            <Field label="Start date">
              <input
                onChange={(event) =>
                  setForm({ ...form, start_date: event.target.value })
                }
                type="date"
                value={String(form.start_date ?? "")}
              />
            </Field>
            <Field label="Expected completion">
              <input
                onChange={(event) =>
                  setForm({
                    ...form,
                    expected_completion_date: event.target.value,
                  })
                }
                type="date"
                value={String(form.expected_completion_date ?? "")}
              />
            </Field>
            <Field label="RERA number">
              <input
                onChange={(event) =>
                  setForm({ ...form, rera_number: event.target.value })
                }
                value={String(form.rera_number ?? "")}
              />
            </Field>
            <Field label="Postal code">
              <input
                onChange={(event) =>
                  setForm({ ...form, postal_code: event.target.value })
                }
                value={String(form.postal_code ?? "")}
              />
            </Field>
            <Field label="Address">
              <input
                onChange={(event) =>
                  setForm({ ...form, address: event.target.value })
                }
                value={String(form.address ?? "")}
              />
            </Field>
          </div>
          <div className={settingsUi.actions}>
            <SaveButton busy={props.busy}>Create project</SaveButton>
          </div>
        </form>
      </Card>
    </div>
  );
}

function PeoplePanel(props: PanelProps) {
  const [mode, setMode] = useState<"user" | "team" | "role">("user");
  const [form, setForm] = useState<Row>({ is_active: true });
  const create = async (event: FormEvent) => {
    event.preventDefault();
    let url = "/api/users";
    let payload: Row = form;
    if (mode === "team") {
      url = "/api/teams";
      payload = {
        company_id: props.context?.company.company_id,
        name: form.name,
        team_type: form.team_type,
        description: form.description || null,
      };
    }
    if (mode === "role") {
      url = "/api/roles";
      payload = {
        role_key: form.role_key,
        role_name: form.role_name,
        description: form.description || null,
      };
    }
    const result = await props.save(
      url,
      "POST",
      payload,
      `${mode} created`,
      props.loadAll,
    );
    if (result) setForm({ is_active: true });
  };
  return (
    <div className={settingsUi.stack}>
      <div className="grid grid-cols-3 gap-3 max-[560px]:grid-cols-1 [&>div]:flex [&>div]:min-h-24 [&>div]:flex-col [&>div]:justify-between [&>div]:rounded-2xl [&>div]:border [&>div]:border-white/[0.08] [&>div]:bg-[linear-gradient(145deg,rgba(35,117,95,0.12),rgba(255,255,255,0.025))] [&>div]:p-4 [&_span]:text-[9px] [&_span]:font-semibold [&_span]:uppercase [&_span]:tracking-[0.12em] [&_span]:text-[#68716e] [&_strong]:font-[var(--font-bricolage)] [&_strong]:text-2xl">
        <div>
          <span>Users</span>
          <strong>{props.users.length}</strong>
        </div>
        <div>
          <span>Teams</span>
          <strong>{props.teams.length}</strong>
        </div>
        <div>
          <span>Roles</span>
          <strong>{props.roles.length}</strong>
        </div>
      </div>
      <Card title="People and access">
        <div className="mb-5 flex w-max gap-1 rounded-xl border border-white/[0.07] bg-black/30 p-1 max-[560px]:w-full [&_button]:h-8 [&_button]:rounded-lg [&_button]:border-0 [&_button]:px-3.5 [&_button]:text-[10px] [&_button]:text-[#888f8c] [&_button]:transition">
          <button
            className={
              mode === "user" ? "bg-white/10! text-white!" : "bg-transparent"
            }
            onClick={() => {
              setMode("user");
              setForm({ is_active: true });
            }}
            type="button"
          >
            Users
          </button>
          <button
            className={
              mode === "team" ? "bg-white/10! text-white!" : "bg-transparent"
            }
            onClick={() => {
              setMode("team");
              setForm({ is_active: true });
            }}
            type="button"
          >
            Teams
          </button>
          <button
            className={
              mode === "role" ? "bg-white/10! text-white!" : "bg-transparent"
            }
            onClick={() => {
              setMode("role");
              setForm({ is_active: true });
            }}
            type="button"
          >
            Roles
          </button>
        </div>
        {mode === "user" && (
          <ListTable
            rows={props.users}
            columns={[
              {
                key: "first_name",
                label: "Name",
                render: (row) =>
                  `${value(row, "first_name")} ${row.last_name ?? ""}`,
              },
              { key: "email", label: "Email" },
              {
                key: "is_active",
                label: "Status",
                render: (row) => (
                  <span
                    className={`${settingsUi.status} ${row.is_active ? settingsUi.statusOn : ""}`}
                  >
                    {row.is_active ? "Active" : "Inactive"}
                  </span>
                ),
              },
            ]}
          />
        )}
        {mode === "team" && (
          <ListTable
            rows={props.teams}
            columns={[
              { key: "name", label: "Team" },
              { key: "team_type", label: "Type" },
              {
                key: "is_active",
                label: "Status",
                render: (row) => (
                  <span
                    className={`${settingsUi.status} ${row.is_active ? settingsUi.statusOn : ""}`}
                  >
                    {row.is_active ? "Active" : "Inactive"}
                  </span>
                ),
              },
            ]}
          />
        )}
        {mode === "role" && (
          <ListTable
            rows={props.roles}
            columns={[
              { key: "role_name", label: "Role" },
              { key: "role_key", label: "Key" },
              {
                key: "is_system_role",
                label: "Type",
                render: (row) => (row.is_system_role ? "System" : "Custom"),
              },
            ]}
          />
        )}
      </Card>
      <Card title={`Add ${mode}`}>
        <form className={settingsUi.form} onSubmit={create}>
          <div className={settingsUi.grid}>
            {mode === "user" && (
              <>
                <Field label="First name">
                  <input
                    required
                    onChange={(e) =>
                      setForm({ ...form, first_name: e.target.value })
                    }
                    value={String(form.first_name ?? "")}
                  />
                </Field>
                <Field label="Last name">
                  <input
                    onChange={(e) =>
                      setForm({ ...form, last_name: e.target.value })
                    }
                    value={String(form.last_name ?? "")}
                  />
                </Field>
                <Field label="Username">
                  <input
                    required
                    onChange={(e) =>
                      setForm({ ...form, username: e.target.value })
                    }
                    value={String(form.username ?? "")}
                  />
                </Field>
                <Field label="Email">
                  <input
                    required
                    type="email"
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                    value={String(form.email ?? "")}
                  />
                </Field>
                <Field label="Temporary password">
                  <input
                    required
                    minLength={8}
                    type="password"
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                    value={String(form.password ?? "")}
                  />
                </Field>
                <Field label="Role">
                  <select
                    required
                    onChange={(e) =>
                      setForm({ ...form, role_id: e.target.value })
                    }
                    value={String(form.role_id ?? "")}
                  >
                    <option value="">Select role</option>
                    {props.roles
                      .filter((row) => row.is_active !== false)
                      .map((row) => (
                        <option
                          key={String(row.role_id)}
                          value={String(row.role_id)}
                        >
                          {value(row, "role_name")}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Team">
                  <select
                    onChange={(e) =>
                      setForm({ ...form, team_id: e.target.value || null })
                    }
                    value={String(form.team_id ?? "")}
                  >
                    <option value="">No team</option>
                    {props.teams
                      .filter((row) => row.is_active !== false)
                      .map((row) => (
                        <option
                          key={String(row.team_id)}
                          value={String(row.team_id)}
                        >
                          {value(row, "name")}
                        </option>
                      ))}
                  </select>
                </Field>
              </>
            )}
            {mode === "team" && (
              <>
                <Field label="Team name">
                  <input
                    required
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    value={String(form.name ?? "")}
                  />
                </Field>
                <Field label="Team type">
                  <input
                    required
                    onChange={(e) =>
                      setForm({ ...form, team_type: e.target.value })
                    }
                    placeholder="sales"
                    value={String(form.team_type ?? "")}
                  />
                </Field>
                <Field label="Description">
                  <input
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    value={String(form.description ?? "")}
                  />
                </Field>
              </>
            )}
            {mode === "role" && (
              <>
                <Field label="Role name">
                  <input
                    required
                    onChange={(e) =>
                      setForm({ ...form, role_name: e.target.value })
                    }
                    value={String(form.role_name ?? "")}
                  />
                </Field>
                <Field label="Role key">
                  <input
                    required
                    onChange={(e) =>
                      setForm({
                        ...form,
                        role_key: e.target.value
                          .toUpperCase()
                          .replaceAll(" ", "_"),
                      })
                    }
                    value={String(form.role_key ?? "")}
                  />
                </Field>
                <Field label="Description">
                  <input
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    value={String(form.description ?? "")}
                  />
                </Field>
              </>
            )}
          </div>
          <div className={settingsUi.actions}>
            <SaveButton busy={props.busy}>Create</SaveButton>
          </div>
        </form>
      </Card>
    </div>
  );
}

function CatalogPanel(
  props: PanelProps & { kind: "sources" | "campaigns" | "tags"; rows: Row[] },
) {
  const [form, setForm] = useState<Row>({});
  const labels = { sources: "Lead source", campaigns: "Campaign", tags: "Tag" };
  const toggleCatalogItem = (row: Row) => {
    if (props.kind === "tags") {
      void props.save(
        `/api/tags/${String(row.tag_id)}/archive`,
        "POST",
        {},
        "Tag archived",
        props.loadAll,
      );
      return;
    }
    const resource = props.kind === "sources" ? "lead-sources" : "campaigns";
    const id = String(
      props.kind === "sources" ? row.source_id : row.campaign_id,
    );
    const active = Boolean(row.is_active);
    void props.save(
      `/api/${resource}/${id}/${active ? "deactivate" : "activate"}`,
      "POST",
      {},
      `${labels[props.kind]} ${active ? "deactivated" : "activated"}`,
      props.loadAll,
    );
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    const payload =
      props.kind === "sources"
        ? { source_name: form.name, source_type: form.type, code: form.code }
        : props.kind === "campaigns"
          ? {
              campaign_name: form.name,
              campaign_code: form.code,
              source_id: form.source_id || null,
              campaign_type: form.type || null,
              start_date: form.start_date || null,
              end_date: form.end_date || null,
              budget: form.budget ? Number(form.budget) : null,
            }
          : {
              tag_name: form.name,
              description: form.description || null,
              color: form.color || null,
            };
    const result = await props.save(
      `/api/${props.kind === "sources" ? "lead-sources" : props.kind}`,
      "POST",
      payload,
      `${labels[props.kind]} created`,
      props.loadAll,
    );
    if (result) setForm({});
  };
  const columns =
    props.kind === "sources"
      ? [
          { key: "source_name", label: "Source" },
          { key: "source_type", label: "Type" },
          { key: "code", label: "Code" },
          {
            key: "is_active",
            label: "Status",
            render: (row: Row) => (
              <span
                className={`${settingsUi.status} ${row.is_active ? settingsUi.statusOn : ""}`}
              >
                {row.is_active ? "Active" : "Inactive"}
              </span>
            ),
          },
          {
            key: "action",
            label: "",
            render: (row: Row) => (
              <button
                className={settingsUi.tableAction}
                disabled={props.busy}
                onClick={() => toggleCatalogItem(row)}
                type="button"
              >
                {row.is_active ? "Deactivate" : "Activate"}
              </button>
            ),
          },
        ]
      : props.kind === "campaigns"
        ? [
            { key: "campaign_name", label: "Campaign" },
            { key: "campaign_code", label: "Code" },
            { key: "campaign_type", label: "Type" },
            { key: "budget", label: "Budget" },
            {
              key: "action",
              label: "",
              render: (row: Row) => (
                <button
                  className={settingsUi.tableAction}
                  disabled={props.busy}
                  onClick={() => toggleCatalogItem(row)}
                  type="button"
                >
                  {row.is_active ? "Deactivate" : "Activate"}
                </button>
              ),
            },
          ]
        : [
            { key: "tag_name", label: "Tag" },
            {
              key: "color",
              label: "Colour",
              render: (row: Row) => (
                <span className="flex items-center gap-2">
                  <i className="size-2.5 rounded-full border border-white/20 bg-[#65c9a7]" />
                  {value(row, "color")}
                </span>
              ),
            },
            { key: "description", label: "Description" },
            {
              key: "action",
              label: "",
              render: (row: Row) => (
                <button
                  className={settingsUi.tableAction}
                  disabled={props.busy}
                  onClick={() => toggleCatalogItem(row)}
                  type="button"
                >
                  Archive
                </button>
              ),
            },
          ];
  return (
    <div className={settingsUi.stack}>
      <Card title={`${labels[props.kind]} directory`}>
        <ListTable rows={props.rows} columns={columns} />
      </Card>
      <Card title={`Add ${labels[props.kind].toLowerCase()}`}>
        <form className={settingsUi.form} onSubmit={create}>
          <div className={settingsUi.grid}>
            <Field label="Name">
              <input
                required
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                value={String(form.name ?? "")}
              />
            </Field>
            {props.kind !== "tags" && (
              <Field label="Code">
                <input
                  required
                  onChange={(e) =>
                    setForm({
                      ...form,
                      code: e.target.value.toUpperCase().replaceAll(" ", "_"),
                    })
                  }
                  value={String(form.code ?? "")}
                />
              </Field>
            )}
            {props.kind !== "tags" && (
              <Field label="Type">
                <input
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  required={props.kind === "sources"}
                  value={String(form.type ?? "")}
                />
              </Field>
            )}
            {props.kind === "campaigns" && (
              <>
                <Field label="Lead source">
                  <select
                    onChange={(e) =>
                      setForm({ ...form, source_id: e.target.value })
                    }
                    value={String(form.source_id ?? "")}
                  >
                    <option value="">No source</option>
                    {props.sources.map((row) => (
                      <option
                        key={String(row.source_id)}
                        value={String(row.source_id)}
                      >
                        {value(row, "source_name")}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Start date">
                  <input
                    type="date"
                    onChange={(e) =>
                      setForm({ ...form, start_date: e.target.value })
                    }
                    value={String(form.start_date ?? "")}
                  />
                </Field>
                <Field label="End date">
                  <input
                    type="date"
                    onChange={(e) =>
                      setForm({ ...form, end_date: e.target.value })
                    }
                    value={String(form.end_date ?? "")}
                  />
                </Field>
                <Field label="Budget">
                  <input
                    min="0"
                    type="number"
                    onChange={(e) =>
                      setForm({ ...form, budget: e.target.value })
                    }
                    value={String(form.budget ?? "")}
                  />
                </Field>
              </>
            )}
            {props.kind === "tags" && (
              <>
                <Field label="Colour">
                  <input
                    type="color"
                    onChange={(e) =>
                      setForm({ ...form, color: e.target.value })
                    }
                    value={String(form.color ?? "#65c9a7")}
                  />
                </Field>
                <Field label="Description">
                  <input
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    value={String(form.description ?? "")}
                  />
                </Field>
              </>
            )}
          </div>
          <div className={settingsUi.actions}>
            <SaveButton busy={props.busy}>Create</SaveButton>
          </div>
        </form>
      </Card>
    </div>
  );
}

function LeadConfigurationPanel(props: PanelProps & { projectId: number }) {
  const [form, setForm] = useState<Row>(props.leadConfiguration);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      default_source_id: form.default_source_id || null,
      default_campaign_id: form.default_campaign_id || null,
      auto_assignment_enabled: Boolean(form.auto_assignment_enabled),
      assignment_strategy: form.assignment_strategy,
      duplicate_check_enabled: Boolean(form.duplicate_check_enabled),
      duplicate_window_days: Number(form.duplicate_window_days),
      response_sla_minutes: Number(form.response_sla_minutes),
    };
    const result = await props.save(
      `/api/projects/${props.projectId}/lead-configuration`,
      "PATCH",
      payload,
      "Lead configuration updated",
    );
    if (result?.configuration)
      props.setLeadConfiguration(result.configuration as Row);
  };
  return (
    <form className={settingsUi.stack} onSubmit={submit}>
      <Card title="Lead defaults">
        <div className={settingsUi.grid}>
          <Field label="Default lead source">
            <select
              onChange={(e) =>
                setForm({ ...form, default_source_id: e.target.value })
              }
              value={String(form.default_source_id ?? "")}
            >
              <option value="">No default</option>
              {props.sources
                .filter((row) => row.is_active !== false)
                .map((row) => (
                  <option
                    key={String(row.source_id)}
                    value={String(row.source_id)}
                  >
                    {value(row, "source_name")}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Default campaign">
            <select
              onChange={(e) =>
                setForm({ ...form, default_campaign_id: e.target.value })
              }
              value={String(form.default_campaign_id ?? "")}
            >
              <option value="">No default</option>
              {props.campaigns
                .filter((row) => row.is_active !== false)
                .map((row) => (
                  <option
                    key={String(row.campaign_id)}
                    value={String(row.campaign_id)}
                  >
                    {value(row, "campaign_name")}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Assignment strategy">
            <select
              onChange={(e) =>
                setForm({ ...form, assignment_strategy: e.target.value })
              }
              value={String(form.assignment_strategy ?? "manual")}
            >
              <option value="manual">Manual</option>
              <option value="round_robin">Round robin</option>
              <option value="load_balanced">Load balanced</option>
            </select>
          </Field>
          <Field label="Response SLA (minutes)">
            <input
              min="1"
              type="number"
              value={String(form.response_sla_minutes ?? 30)}
              onChange={(e) =>
                setForm({ ...form, response_sla_minutes: e.target.value })
              }
            />
          </Field>
          <Field label="Duplicate window (days)">
            <input
              min="1"
              type="number"
              value={String(form.duplicate_window_days ?? 90)}
              onChange={(e) =>
                setForm({ ...form, duplicate_window_days: e.target.value })
              }
            />
          </Field>
        </div>
      </Card>
      <Card title="Automation">
        <Toggle
          checked={Boolean(form.auto_assignment_enabled)}
          label="Automatically assign incoming leads"
          onChange={(checked) =>
            setForm({ ...form, auto_assignment_enabled: checked })
          }
        />
        <Toggle
          checked={form.duplicate_check_enabled !== false}
          label="Run duplicate checks during intake"
          onChange={(checked) =>
            setForm({ ...form, duplicate_check_enabled: checked })
          }
        />
      </Card>
      <div className={settingsUi.actions}>
        <SaveButton busy={props.busy} />
      </div>
    </form>
  );
}

function DefinitionEditor({
  addLabel,
  busy,
  columns,
  items,
  onAdd,
  onChange,
  onRemove,
  onSave,
  title,
}: {
  addLabel: string;
  busy: boolean;
  columns: {
    key: string;
    label: string;
    type?: "text" | "select" | "checkbox";
    options?: string[];
  }[];
  items: Row[];
  onAdd: () => void;
  onChange: (index: number, key: string, value: unknown) => void;
  onRemove: (index: number) => void;
  onSave: () => void;
  title: string;
}) {
  return (
    <Card title={title}>
      <div className="flex flex-col gap-2.5">
        {items.map((item, index) => (
          <div
            className="grid grid-cols-[28px_minmax(0,1fr)_36px] items-end gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-3.5 max-[620px]:grid-cols-[28px_minmax(0,1fr)]"
            key={String(
              item.stage_id ?? item.field_id ?? item.reason_id ?? index,
            )}
          >
            <span className="mb-2 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[10px] font-semibold text-[#78807d]">
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
              {columns.map((column) =>
                column.type === "checkbox" ? (
                  <label
                    className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 text-[10px] text-[#a8afac]"
                    key={column.key}
                  >
                    <input
                      className="accent-[#35ae86]"
                      checked={Boolean(item[column.key])}
                      onChange={(e) =>
                        onChange(index, column.key, e.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>{column.label}</span>
                  </label>
                ) : (
                  <div
                    className="min-w-[150px] flex-[1_1_180px]"
                    key={column.key}
                  >
                    <Field label={column.label}>
                      {column.type === "select" ? (
                        <select
                          value={String(item[column.key] ?? "")}
                          onChange={(e) =>
                            onChange(index, column.key, e.target.value)
                          }
                        >
                          {column.options?.map((option) => (
                            <option key={option} value={option}>
                              {option.replaceAll("_", " ")}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={String(item[column.key] ?? "")}
                          onChange={(e) =>
                            onChange(index, column.key, e.target.value)
                          }
                        />
                      )}
                    </Field>
                  </div>
                ),
              )}
            </div>
            <button
              className="flex size-9 shrink-0 items-center justify-center self-end rounded-xl border border-red-400/10 bg-red-400/[0.04] text-base text-red-300/70 transition hover:border-red-400/30 hover:bg-red-400/10 hover:text-red-200 max-[620px]:col-start-2 max-[620px]:justify-self-end"
              onClick={() => onRemove(index)}
              title="Remove"
              type="button"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 max-[560px]:items-stretch max-[560px]:flex-col">
        <button
          className={settingsUi.secondaryButton}
          onClick={onAdd}
          type="button"
        >
          + {addLabel}
        </button>
        <button
          className={settingsUi.primaryButton}
          disabled={busy || !items.length}
          onClick={onSave}
          type="button"
        >
          {busy ? "Saving…" : "Save order"}
        </button>
      </div>
    </Card>
  );
}

function StagesPanel(props: PanelProps & { projectId: number }) {
  const change = (index: number, key: string, next: unknown) =>
    props.setStages(
      props.stages.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [key]: next,
              ...(key === "is_initial" && next ? {} : {}),
            }
          : key === "is_initial" && next
            ? { ...item, is_initial: false }
            : item,
      ),
    );
  const saveStages = () =>
    void props.save(
      `/api/projects/${props.projectId}/lead-stages`,
      "PUT",
      {
        stages: props.stages.map((stage) => ({
          stage_key: stage.stage_key,
          stage_name: stage.stage_name,
          is_initial: Boolean(stage.is_initial),
          is_terminal: Boolean(stage.is_terminal),
        })),
      },
      "Lead stages updated",
      () => props.loadProject(props.projectId),
    );
  return (
    <DefinitionEditor
      title="Lead lifecycle"
      addLabel="Add stage"
      busy={props.busy}
      items={props.stages}
      columns={[
        { key: "stage_name", label: "Stage name" },
        { key: "stage_key", label: "Key" },
        { key: "is_initial", label: "Initial", type: "checkbox" },
        { key: "is_terminal", label: "Terminal", type: "checkbox" },
      ]}
      onAdd={() =>
        props.setStages([
          ...props.stages,
          {
            stage_key: `stage_${props.stages.length + 1}`,
            stage_name: "New stage",
            is_initial: !props.stages.length,
            is_terminal: false,
          },
        ])
      }
      onChange={change}
      onRemove={(index) =>
        props.setStages(
          props.stages.filter((_, itemIndex) => itemIndex !== index),
        )
      }
      onSave={saveStages}
    />
  );
}

function QualificationPanel(props: PanelProps & { projectId: number }) {
  const change = (index: number, key: string, next: unknown) =>
    props.setQualificationFields(
      props.qualificationFields.map((item, itemIndex) =>
        itemIndex === index
          ? key === "options_text"
            ? {
                ...item,
                options: String(next)
                  .split(",")
                  .map((option) => option.trim())
                  .filter(Boolean),
              }
            : { ...item, [key]: next }
          : item,
      ),
    );
  const saveFields = () =>
    void props.save(
      `/api/projects/${props.projectId}/qualification-fields`,
      "PUT",
      {
        fields: props.qualificationFields.map((field) => ({
          field_key: field.field_key,
          field_label: field.field_label,
          field_type: field.field_type,
          is_required: Boolean(field.is_required),
          options: Array.isArray(field.options) ? field.options : [],
        })),
      },
      "Qualification fields updated",
      () => props.loadProject(props.projectId),
    );
  return (
    <DefinitionEditor
      title="Qualification form"
      addLabel="Add field"
      busy={props.busy}
      items={props.qualificationFields.map((field) => ({
        ...field,
        options_text: Array.isArray(field.options)
          ? field.options.join(", ")
          : "",
      }))}
      columns={[
        { key: "field_label", label: "Label" },
        { key: "field_key", label: "Key" },
        {
          key: "field_type",
          label: "Type",
          type: "select",
          options: [
            "text",
            "number",
            "boolean",
            "date",
            "single_select",
            "multi_select",
          ],
        },
        { key: "options_text", label: "Options (comma separated)" },
        { key: "is_required", label: "Required", type: "checkbox" },
      ]}
      onAdd={() =>
        props.setQualificationFields([
          ...props.qualificationFields,
          {
            field_key: `field_${props.qualificationFields.length + 1}`,
            field_label: "New field",
            field_type: "text",
            is_required: false,
            options: [],
          },
        ])
      }
      onChange={change}
      onRemove={(index) =>
        props.setQualificationFields(
          props.qualificationFields.filter(
            (_, itemIndex) => itemIndex !== index,
          ),
        )
      }
      onSave={saveFields}
    />
  );
}

function ClosingReasonsPanel(props: PanelProps & { projectId: number }) {
  const change = (index: number, key: string, next: unknown) =>
    props.setClosingReasons(
      props.closingReasons.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: next } : item,
      ),
    );
  const saveReasons = () =>
    void props.save(
      `/api/projects/${props.projectId}/closing-reasons`,
      "PUT",
      {
        reasons: props.closingReasons.map((reason) => ({
          reason_key: reason.reason_key,
          reason_name: reason.reason_name,
          outcome: reason.outcome,
        })),
      },
      "Closing reasons updated",
      () => props.loadProject(props.projectId),
    );
  return (
    <DefinitionEditor
      title="Closing outcomes"
      addLabel="Add reason"
      busy={props.busy}
      items={props.closingReasons}
      columns={[
        { key: "reason_name", label: "Reason" },
        { key: "reason_key", label: "Key" },
        {
          key: "outcome",
          label: "Outcome",
          type: "select",
          options: ["won", "lost"],
        },
      ]}
      onAdd={() =>
        props.setClosingReasons([
          ...props.closingReasons,
          {
            reason_key: `reason_${props.closingReasons.length + 1}`,
            reason_name: "New reason",
            outcome: "lost",
          },
        ])
      }
      onChange={change}
      onRemove={(index) =>
        props.setClosingReasons(
          props.closingReasons.filter((_, itemIndex) => itemIndex !== index),
        )
      }
      onSave={saveReasons}
    />
  );
}

function AutomationPanel(
  props: PanelProps & {
    kind: "queues" | "routing-rules" | "sla-rules";
    projectId: number;
    rows: Row[];
  },
) {
  const [form, setForm] = useState<Row>({ priority: 100, conditions: "{}" });
  const toggleActive = (row: Row) => {
    const active = Boolean(row.is_active);
    const id = String(row.queue_id ?? row.rule_id ?? row.sla_rule_id);
    if (props.kind === "queues") {
      void props.save(
        `/api/queues/${id}`,
        "PATCH",
        { is_active: !active },
        `Queue ${active ? "deactivated" : "activated"}`,
        () => props.loadProject(props.projectId),
      );
      return;
    }
    void props.save(
      `/api/${props.kind}/${id}/${active ? "deactivate" : "activate"}`,
      "POST",
      {},
      `Rule ${active ? "deactivated" : "activated"}`,
      () => props.loadProject(props.projectId),
    );
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    let payload: Row;
    if (props.kind === "queues")
      payload = {
        project_id: props.projectId,
        queue_code: form.code,
        queue_name: form.name,
        description: form.description || null,
        assignment_strategy: form.strategy || "manual",
        team_id: form.team_id || null,
        member_user_ids: [],
      };
    else if (props.kind === "routing-rules") {
      let conditions: Row;
      try {
        conditions = JSON.parse(String(form.conditions || "{}")) as Row;
      } catch {
        toast.error("Conditions must contain valid JSON");
        return;
      }
      payload = {
        project_id: props.projectId,
        rule_name: form.name,
        description: form.description || null,
        priority: Number(form.priority || 100),
        conditions,
        action_type: form.action_type || "queue",
        target_queue_id:
          form.action_type === "queue" || !form.action_type
            ? form.target_id
            : null,
        target_user_id: form.action_type === "user" ? form.target_id : null,
        target_team_id: form.action_type === "team" ? form.target_id : null,
      };
    } else {
      let conditions: Row;
      try {
        conditions = JSON.parse(String(form.conditions || "{}")) as Row;
      } catch {
        toast.error("Conditions must contain valid JSON");
        return;
      }
      payload = {
        project_id: props.projectId,
        rule_name: form.name,
        description: form.description || null,
        applies_to: form.applies_to || "assignment",
        priority: Number(form.priority || 100),
        conditions,
        response_minutes: form.response_minutes
          ? Number(form.response_minutes)
          : null,
        resolution_minutes: form.resolution_minutes
          ? Number(form.resolution_minutes)
          : null,
        escalation_minutes: form.escalation_minutes
          ? Number(form.escalation_minutes)
          : null,
      };
    }
    const result = await props.save(
      `/api/${props.kind}`,
      "POST",
      payload,
      "Configuration created",
      () => props.loadProject(props.projectId),
    );
    if (result) setForm({ priority: 100, conditions: "{}" });
  };
  const title =
    props.kind === "queues"
      ? "Assignment queues"
      : props.kind === "routing-rules"
        ? "Routing rules"
        : "SLA rules";
  const columns =
    props.kind === "queues"
      ? [
          { key: "queue_name", label: "Queue" },
          { key: "queue_code", label: "Code" },
          { key: "assignment_strategy", label: "Strategy" },
          { key: "waiting_count", label: "Waiting" },
          {
            key: "action",
            label: "",
            render: (row: Row) =>
              props.admin ? (
                <button
                  className={settingsUi.tableAction}
                  disabled={props.busy}
                  onClick={() => toggleActive(row)}
                  type="button"
                >
                  {row.is_active ? "Deactivate" : "Activate"}
                </button>
              ) : null,
          },
        ]
      : props.kind === "routing-rules"
        ? [
            { key: "rule_name", label: "Rule" },
            { key: "priority", label: "Priority" },
            { key: "action_type", label: "Action" },
            {
              key: "is_active",
              label: "Status",
              render: (row: Row) => (
                <span
                  className={`${settingsUi.status} ${row.is_active ? settingsUi.statusOn : ""}`}
                >
                  {row.is_active ? "Active" : "Draft"}
                </span>
              ),
            },
            {
              key: "action",
              label: "",
              render: (row: Row) =>
                props.admin ? (
                  <button
                    className={settingsUi.tableAction}
                    disabled={props.busy}
                    onClick={() => toggleActive(row)}
                    type="button"
                  >
                    {row.is_active ? "Deactivate" : "Activate"}
                  </button>
                ) : null,
            },
          ]
        : [
            { key: "rule_name", label: "Rule" },
            { key: "applies_to", label: "Applies to" },
            { key: "response_minutes", label: "Response" },
            { key: "resolution_minutes", label: "Resolution" },
            {
              key: "is_active",
              label: "Status",
              render: (row: Row) => (
                <span
                  className={`${settingsUi.status} ${row.is_active ? settingsUi.statusOn : ""}`}
                >
                  {row.is_active ? "Active" : "Draft"}
                </span>
              ),
            },
            {
              key: "action",
              label: "",
              render: (row: Row) =>
                props.admin ? (
                  <button
                    className={settingsUi.tableAction}
                    disabled={props.busy}
                    onClick={() => toggleActive(row)}
                    type="button"
                  >
                    {row.is_active ? "Deactivate" : "Activate"}
                  </button>
                ) : null,
            },
          ];
  return (
    <div className={settingsUi.stack}>
      <Card title={title}>
        <ListTable rows={props.rows} columns={columns} />
      </Card>
      {props.admin && (
        <Card title={`Create ${props.kind === "queues" ? "queue" : "rule"}`}>
          <form className={settingsUi.form} onSubmit={create}>
            <div className={settingsUi.grid}>
              <Field label="Name">
                <input
                  required
                  value={String(form.name ?? "")}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              {props.kind === "queues" ? (
                <>
                  <Field label="Code">
                    <input
                      required
                      value={String(form.code ?? "")}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          code: e.target.value
                            .toUpperCase()
                            .replaceAll(" ", "_"),
                        })
                      }
                    />
                  </Field>
                  <Field label="Strategy">
                    <select
                      value={String(form.strategy ?? "manual")}
                      onChange={(e) =>
                        setForm({ ...form, strategy: e.target.value })
                      }
                    >
                      <option value="manual">Manual</option>
                      <option value="round_robin">Round robin</option>
                      <option value="load_balanced">Load balanced</option>
                    </select>
                  </Field>
                  <Field label="Team">
                    <select
                      value={String(form.team_id ?? "")}
                      onChange={(e) =>
                        setForm({ ...form, team_id: e.target.value })
                      }
                    >
                      <option value="">No team</option>
                      {props.teams.map((row) => (
                        <option
                          key={String(row.team_id)}
                          value={String(row.team_id)}
                        >
                          {value(row, "name")}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Priority">
                    <input
                      min="1"
                      type="number"
                      value={String(form.priority ?? 100)}
                      onChange={(e) =>
                        setForm({ ...form, priority: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Conditions (JSON)">
                    <input
                      value={String(form.conditions ?? "{}")}
                      onChange={(e) =>
                        setForm({ ...form, conditions: e.target.value })
                      }
                    />
                  </Field>
                  {props.kind === "routing-rules" ? (
                    <>
                      <Field label="Action">
                        <select
                          value={String(form.action_type ?? "queue")}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              action_type: e.target.value,
                              target_id: "",
                            })
                          }
                        >
                          <option value="queue">Queue</option>
                          <option value="user">User</option>
                          <option value="team">Team</option>
                        </select>
                      </Field>
                      <Field label="Target">
                        <select
                          required
                          value={String(form.target_id ?? "")}
                          onChange={(e) =>
                            setForm({ ...form, target_id: e.target.value })
                          }
                        >
                          <option value="">Select target</option>
                          {(form.action_type === "user"
                            ? props.users
                            : form.action_type === "team"
                              ? props.teams
                              : props.queues
                          ).map((row) => (
                            <option
                              key={String(
                                row.user_id ?? row.team_id ?? row.queue_id,
                              )}
                              value={String(
                                row.user_id ?? row.team_id ?? row.queue_id,
                              )}
                            >
                              {value(
                                row,
                                form.action_type === "user"
                                  ? "first_name"
                                  : form.action_type === "team"
                                    ? "name"
                                    : "queue_name",
                              )}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field label="Applies to">
                        <select
                          value={String(form.applies_to ?? "assignment")}
                          onChange={(e) =>
                            setForm({ ...form, applies_to: e.target.value })
                          }
                        >
                          <option value="assignment">Assignment</option>
                          <option value="lead">Lead</option>
                        </select>
                      </Field>
                      <Field label="Response minutes">
                        <input
                          min="1"
                          type="number"
                          value={String(form.response_minutes ?? "")}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              response_minutes: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="Resolution minutes">
                        <input
                          min="1"
                          type="number"
                          value={String(form.resolution_minutes ?? "")}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              resolution_minutes: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="Escalation minutes">
                        <input
                          min="0"
                          type="number"
                          value={String(form.escalation_minutes ?? "")}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              escalation_minutes: e.target.value,
                            })
                          }
                        />
                      </Field>
                    </>
                  )}
                </>
              )}
            </div>
            <div className={settingsUi.actions}>
              <SaveButton busy={props.busy}>Create</SaveButton>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
