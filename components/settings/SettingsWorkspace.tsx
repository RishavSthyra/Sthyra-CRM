"use client";

import {
  type Dispatch,
  FormEvent,
  ReactNode,
  type SetStateAction,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Bell,
  Ban,
  Building2,
  CheckCircle2,
  Check,
  ChevronDown,
  CircleGauge,
  ClipboardList,
  Clock3,
  Copy,
  FolderKanban,
  FileDown,
  History,
  Funnel,
  Inbox,
  ListTree,
  LoaderCircle,
  Mail,
  MapPin,
  Megaphone,
  Pencil,
  Plus,
  Route,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Tag,
  Timer,
  TimerOff,
  Unplug,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { fetchWithSession, getApiError } from "@/lib/clientAuth";
import { generateCodeFromName } from "@/utils/generateCodeFromName";
import {
  hasAuditLogAccess,
  isCompanyWideProjectRole,
  isLeadershipTeamName,
} from "@/lib/projectAccessPolicy";

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
  team: { team_id: string; team_name: string };
  role_key: string;
  can_view_all_projects: boolean;
  permissions: string[];
  projects: Project[];
};
type Section =
  | "profile"
  | "email-accounts"
  | "notifications"
  | "availability"
  | "security"
  | "company"
  | "projects"
  | "regions"
  | "people"
  | "sources"
  | "campaigns"
  | "tags"
  | "data-tools"
  | "audit-log"
  | "lead-configuration"
  | "lead-stages"
  | "opportunity-stages"
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
      id: "email-accounts",
      label: "Email accounts",
      description: "Connect Gmail or Outlook for lead conversations",
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
    id: "regions",
    label: "Regions",
    description: "Markets and project locations",
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
  {
    id: "data-tools",
    label: "Data tools",
    description: "Validated imports and portable exports",
  },
  {
    id: "audit-log",
    label: "Audit log",
    description: "Detailed workspace change history",
  },
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
    description: "Pre-conversion lifecycle",
  },
  {
    id: "opportunity-stages",
    label: "Opportunity stages",
    description: "Post-qualification sales pipeline",
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
    "flex min-w-0 flex-col gap-2 [&>span]:text-[11px] [&>span]:font-medium [&>span]:tracking-wide [&>span]:text-[#8e9693] [&_input]:h-11 [&_input]:w-full [&_input]:min-w-0 [&_input]:rounded-lg [&_input]:border [&_input]:border-white/10 [&_input]:bg-black/25 [&_input]:px-3.5 [&_input]:text-xs [&_input]:text-[#f0f0f0] [&_input]:outline-none [&_input]:transition [&_input]:placeholder:text-white/25 [&_input]:focus:border-[#4ea98b] [&_input]:focus:ring-2 [&_input]:focus:ring-[#4ea98b]/15 [&_input[type=date]]:[color-scheme:dark] [&_select]:h-11 [&_select]:w-full [&_select]:min-w-0 [&_select]:appearance-none [&_select]:rounded-lg [&_select]:border [&_select]:border-white/10 [&_select]:bg-[#0b0d0c] [&_select]:px-3.5 [&_select]:pr-10 [&_select]:text-xs [&_select]:text-[#f0f0f0] [&_select]:outline-none [&_select]:transition [&_select]:focus:border-[#4ea98b] [&_select]:focus:ring-2 [&_select]:focus:ring-[#4ea98b]/15 [&_textarea]:min-h-24 [&_textarea]:w-full [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-white/10 [&_textarea]:bg-black/25 [&_textarea]:p-3.5 [&_textarea]:text-xs [&_textarea]:outline-none [&_textarea]:focus:border-[#4ea98b]",
  primaryButton:
    "inline-flex h-10 items-center justify-center rounded-lg border border-[#3a9e7e] bg-[#287b63] px-5 text-xs font-semibold text-white transition hover:bg-[#309173] disabled:cursor-wait disabled:opacity-50",
  secondaryButton:
    "inline-flex h-10 w-max items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] px-4 text-xs font-medium text-[#e7e7e7] transition hover:border-[#4ea98b]/40 hover:bg-[#4ea98b]/10",
  form: "flex flex-col gap-5",
  grid: "grid grid-cols-2 gap-4 max-[720px]:grid-cols-1",
  compactGrid: "grid max-w-[680px] grid-cols-2 gap-4 max-[720px]:grid-cols-1",
  actions: "flex items-center justify-end gap-3",
  stack: "flex flex-col gap-8",
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
  const isSelect = isValidElement(children) && children.type === "select";
  return (
    <label className={settingsUi.field}>
      <span>{label}</span>
      <div className="relative">
        {children}
        {isSelect && (
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-[#8e9693]"
            strokeWidth={1.8}
          />
        )}
      </div>
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
    <section className="border-b border-white/[0.08] pb-8 last:border-b-0 last:pb-0">
      <header className="mb-5">
        <h2 className="font-[var(--font-bricolage)] text-sm font-semibold text-[#f5f5f5]">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-[11px] leading-relaxed text-[#777f7c]">
            {description}
          </p>
        )}
      </header>
      <div>{children}</div>
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
    <div className="flex min-h-28 items-center justify-center border-y border-white/[0.07] py-8 text-center text-xs text-[#686f6c]">
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
                  row.region_id ??
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

const settingsSectionIcons: Record<Section, LucideIcon> = {
  profile: UserRound,
  "email-accounts": Mail,
  notifications: Bell,
  availability: Clock3,
  security: ShieldCheck,
  company: Building2,
  projects: FolderKanban,
  regions: MapPin,
  people: UsersRound,
  sources: Funnel,
  campaigns: Megaphone,
  tags: Tag,
  "data-tools": FileDown,
  "audit-log": History,
  "lead-configuration": SlidersHorizontal,
  "lead-stages": ListTree,
  "opportunity-stages": FolderKanban,
  "qualification-fields": ClipboardList,
  "closing-reasons": CheckCircle2,
  queues: Inbox,
  "routing-rules": Route,
  "sla-rules": Timer,
};

function SettingsSectionIcon({ section }: { section: Section }) {
  const Icon = settingsSectionIcons[section] ?? CircleGauge;
  return <Icon aria-hidden className="size-full" strokeWidth={1.7} />;
}

export function SettingsWorkspace() {
  const router = useRouter();
  const hasLoadedSettingsRef = useRef(false);
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
  const [invitations, setInvitations] = useState<Row[]>([]);
  const [sources, setSources] = useState<Row[]>([]);
  const [campaigns, setCampaigns] = useState<Row[]>([]);
  const [tags, setTags] = useState<Row[]>([]);
  const [leadConfiguration, setLeadConfiguration] = useState<Row>({});
  const [stages, setStages] = useState<Row[]>([]);
  const [opportunityStages, setOpportunityStages] = useState<Row[]>([]);
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
        opportunityStagesData,
        fieldsData,
        reasonsData,
        queueData,
        routingData,
        slaData,
      ] = await Promise.all([
        api(`/api/projects/${projectId}/lead-configuration`),
        api(`/api/projects/${projectId}/lead-stages`),
        api(`/api/projects/${projectId}/opportunity-stages`),
        api(`/api/projects/${projectId}/qualification-fields`),
        api(`/api/projects/${projectId}/closing-reasons`),
        api(`/api/queues?project_id=${projectId}&limit=100`),
        api(`/api/routing-rules?project_id=${projectId}&limit=100`),
        api(`/api/sla-rules?project_id=${projectId}&limit=100`),
      ]);
      setLeadConfiguration((configurationData.configuration as Row) ?? {});
      setStages((stagesData.stages as Row[]) ?? []);
      setOpportunityStages((opportunityStagesData.stages as Row[]) ?? []);
      setQualificationFields((fieldsData.fields as Row[]) ?? []);
      setClosingReasons((reasonsData.reasons as Row[]) ?? []);
      setQueues((queueData.queues as Row[]) ?? []);
      setRoutingRules((routingData.rules as Row[]) ?? []);
      setSlaRules((slaData.rules as Row[]) ?? []);
    },
    [api],
  );

  const loadAll = useCallback(async () => {
    setLoading(!hasLoadedSettingsRef.current);
    try {
      const [meData, contextData, preferenceData, sessionData] =
        await Promise.all([
          api("/api/auth/me"),
          api("/api/auth/project-context"),
          api("/api/notification-preferences"),
          api("/api/auth/sessions"),
        ]);
      const nextContext = contextData as unknown as ContextData;
      const nextUser = (meData.user as Row) ?? {};
      const contextProjects = Array.isArray(nextContext.projects)
        ? nextContext.projects
        : [];
      const contextProjectRows = contextProjects.map((project) => ({
        ...project,
        is_active: true,
      })) as Row[];
      setUser(nextUser);
      setContext(nextContext);
      // The signed-in user and accessible projects are already authoritative
      // context data. Render them immediately instead of making these panels
      // depend on every secondary settings request succeeding.
      setUsers([nextUser]);
      setProjects(contextProjectRows);
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
      const projectId = contextProjects.some(
        (project) => project.project_id === preferredProject,
      )
        ? preferredProject
        : (contextProjects[0]?.project_id ?? null);
      setSelectedProjectId(projectId);
      const companyId = nextContext.company.company_id;
      const [core, regionData] = await Promise.all([
        Promise.all([
          api(`/api/companies/${companyId}`),
          api(`/api/users/${String(nextUser.user_id)}/availability`),
        ]),
        api("/api/regions?includeInactive=true&limit=100").catch((error) => {
          console.error("Failed to load project regions", error);
          return { regions: [] };
        }),
      ]);
      setCompany((core[0].company as Row) ?? {});
      setAvailability((core[1].availability as Row) ?? {});
      setRegions((regionData.regions as Row[]) ?? []);
      if (
        nextContext.can_view_all_projects ||
        (nextContext.permissions ?? []).some((permission) =>
          [
            "WORKSPACE_MANAGE",
            "PEOPLE_MANAGE",
            "PROJECTS_MANAGE",
            "DATA_EXPORT",
            "DATA_IMPORT",
          ].includes(permission),
        )
      ) {
        const adminResults = await Promise.allSettled([
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
          api("/api/invitations?status=pending"),
        ]);
        const payload = (index: number) =>
          adminResults[index]?.status === "fulfilled"
            ? adminResults[index].value
            : null;
        const loadedUsers = (payload(0)?.users as Row[] | undefined) ?? [];
        const loadedProjects =
          (payload(6)?.projects as Row[] | undefined) ?? [];
        const currentUserId = String(nextUser.user_id ?? "");
        const usersWithCurrent = loadedUsers.some(
          (row) => String(row.user_id ?? "") === currentUserId,
        )
          ? loadedUsers
          : [nextUser, ...loadedUsers];
        const projectIds = new Set(
          loadedProjects.map((row) => String(row.project_id ?? "")),
        );
        const projectsWithContext = [
          ...loadedProjects,
          ...contextProjectRows.filter(
            (row) => !projectIds.has(String(row.project_id ?? "")),
          ),
        ];
        setUsers(usersWithCurrent);
        setTeams((payload(1)?.teams as Row[]) ?? []);
        setRoles((payload(2)?.roles as Row[]) ?? []);
        setSources((payload(3)?.sources as Row[]) ?? []);
        setCampaigns((payload(4)?.campaigns as Row[]) ?? []);
        setTags((payload(5)?.tags as Row[]) ?? []);
        setProjects(projectsWithContext);
        const invitationPayload = payload(7);
        if (invitationPayload) {
          setInvitations(
            (invitationPayload.invitations as Row[] | undefined) ?? [],
          );
        }
        const failedRequests = adminResults.filter(
          (result) => result.status === "rejected",
        );
        if (failedRequests.length) {
          console.error(
            "Some workspace settings requests failed",
            failedRequests.map((result) =>
              result.status === "rejected" ? result.reason : null,
            ),
          );
        }
      }
      if (projectId) await loadProject(projectId);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load settings",
      );
    } finally {
      hasLoadedSettingsRef.current = true;
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
  const permissionKeys = new Set(context?.permissions ?? []);
  const canViewAuditLog = hasAuditLogAccess({
    roleKey: context?.role_key,
    teamName: context?.team.team_name,
  });
  const visibleCompanySections = companySections.filter((item) => {
    if (item.id === "audit-log") return canViewAuditLog;
    if (admin) return true;
    if (item.id === "people") return permissionKeys.has("PEOPLE_MANAGE");
    if (item.id === "projects" || item.id === "regions")
      return permissionKeys.has("PROJECTS_MANAGE");
    if (item.id === "data-tools")
      return (
        permissionKeys.has("DATA_EXPORT") || permissionKeys.has("DATA_IMPORT")
      );
    return permissionKeys.has("WORKSPACE_MANAGE");
  });

  const navGroup = (title: string, items: typeof personalSections) => (
    <div className="flex flex-col gap-0.5 border-t border-white/[0.07] pt-4 first:border-0 first:pt-0">
      <span className="mb-1.5 px-2 text-[9px] font-semibold tracking-[0.08em] text-[#656c69] uppercase">
        {title}
      </span>
      {items.map((item) => (
        <button
          className={`group flex h-9 w-full items-center gap-2.5 rounded-lg border px-2.5 text-left transition ${
            section === item.id
              ? "border-white/[0.06] bg-white/[0.09] text-white"
              : "border-transparent bg-transparent text-[#9da3a1] hover:bg-white/[0.045] hover:text-white"
          }`}
          key={item.id}
          onClick={() => chooseSection(item.id)}
          type="button"
        >
          <span className="size-4 shrink-0 opacity-80">
            <SettingsSectionIcon section={item.id} />
          </span>
          <strong className="truncate text-[11px] font-medium">
            {item.label}
          </strong>
        </button>
      ))}
    </div>
  );

  return (
    <main className="min-h-dvh bg-[#050706] text-[#f5f5f5]">
      <DashboardSidebar />
      <section className="ml-[96px] h-dvh p-3 pl-0 max-[560px]:ml-[84px] max-[560px]:h-auto max-[560px]:min-h-dvh max-[560px]:px-2 max-[560px]:py-2">
        <div className="mx-auto grid h-[calc(100dvh-24px)] max-w-[1800px] grid-cols-[250px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0c0f0e] shadow-[0_24px_80px_rgba(0,0,0,0.38)] max-[820px]:grid-cols-[210px_minmax(0,1fr)] max-[680px]:h-auto max-[680px]:min-h-[calc(100dvh-88px)] max-[680px]:grid-cols-1">
          <aside className="flex min-h-0 flex-col border-r border-white/[0.08] bg-[#0a0d0c] max-[680px]:max-h-[340px] max-[680px]:border-r-0 max-[680px]:border-b">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.08] px-4">
              <Link
                aria-label="Back to dashboard"
                className="flex size-7 items-center justify-center rounded-lg text-[#8e9693] transition hover:bg-white/[0.06] hover:text-white"
                href="/dashboard"
              >
                <ArrowLeft aria-hidden className="size-4" strokeWidth={1.8} />
              </Link>
              <strong className="text-[12px] font-semibold text-[#e7eae9]">
                Workspace settings
              </strong>
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {context && (
                <div className="flex items-center gap-2.5 px-2 py-1">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#286e59] text-xs font-semibold text-white">
                    {context.company.company_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[11px] font-semibold text-[#e4e8e6]">
                      {context.company.company_name}
                    </strong>
                    <small className="block truncate text-[9px] text-[#69716e] capitalize">
                      {context.role_key.replaceAll("_", " ")}
                    </small>
                  </span>
                </div>
              )}
              {navGroup("Personal", personalSections)}
              {visibleCompanySections.length > 0 &&
                navGroup("Administration", visibleCompanySections)}
              <div className="flex flex-col gap-2 border-t border-white/[0.07] pt-4">
                <span className="px-2 text-[9px] font-semibold tracking-[0.08em] text-[#656c69] uppercase">
                  Project settings
                </span>
                <div className="relative">
                  <select
                    className="h-9 w-full appearance-none rounded-lg border border-white/10 bg-[#121614] px-2.5 pr-9 text-[10px] text-[#dfe4e2] outline-none transition focus:border-[#4ea98b]"
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
                      <option
                        key={project.project_id}
                        value={project.project_id}
                      >
                        {project.project_name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-[#79817e]"
                    strokeWidth={1.8}
                  />
                </div>
              </div>
              {selectedProject && navGroup("Current project", projectSections)}
            </div>
          </aside>
          <section className="flex min-h-0 min-w-0 flex-col bg-[#0e1110]">
            <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-white/[0.08] px-5">
              <div className="flex min-w-0 items-center gap-2.5 text-[#cbd0ce]">
                <span className="size-4 shrink-0">
                  <SettingsSectionIcon section={section} />
                </span>
                <strong className="truncate text-[11px] font-medium">
                  {currentDefinition?.label}
                </strong>
              </div>
              {busy && (
                <span className="flex items-center gap-2 rounded-full border border-[#4ea98b]/20 bg-[#16392f]/60 px-3 py-1.5 text-[9px] font-semibold text-[#75d0b1] before:size-1.5 before:animate-pulse before:rounded-full before:bg-[#75d0b1]">
                  Saving
                </span>
              )}
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:#29302d_transparent] [scrollbar-width:thin]">
              {loading ? (
                <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-xs text-[#747b79]">
                  <i className="size-6 animate-spin rounded-full border-2 border-white/10 border-t-[#4ea98b]" />
                  <span>Loading workspace settings…</span>
                </div>
              ) : (
                <div
                  className={
                    section === "people"
                      ? "p-0"
                      : "w-full max-w-[1120px] p-6 sm:p-8"
                  }
                >
                  {section !== "people" && section !== "profile" && (
                    <div className="mb-7">
                      <h1 className="font-[var(--font-bricolage)] text-[26px] font-medium tracking-[-0.02em] text-[#f1f4f3]">
                        {currentDefinition?.label}
                      </h1>
                      <p className="mt-1.5 text-[12px] text-[#858c89]">
                        {currentDefinition?.description}
                      </p>
                    </div>
                  )}
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
                    opportunityStages={opportunityStages}
                    invitations={invitations}
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
                    setInvitations={setInvitations}
                    setLeadConfiguration={setLeadConfiguration}
                    setOpportunityStages={setOpportunityStages}
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
            </div>
          </section>
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
  opportunityStages: Row[];
  invitations: Row[];
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
  setInvitations: Dispatch<SetStateAction<Row[]>>;
  setLeadConfiguration: (row: Row) => void;
  setOpportunityStages: (rows: Row[]) => void;
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
  if (props.section === "email-accounts")
    return <EmailAccountsPanel {...props} />;
  if (props.section === "notifications")
    return <NotificationPanel {...props} />;
  if (props.section === "availability") return <AvailabilityPanel {...props} />;
  if (props.section === "security") return <SecurityPanel {...props} />;
  if (props.section === "company") return <CompanyPanel {...props} />;
  if (props.section === "projects") return <ProjectsPanel {...props} />;
  if (props.section === "regions") return <RegionsPanel {...props} />;
  if (props.section === "people") return <PeoplePanel {...props} />;
  if (props.section === "sources")
    return <CatalogPanel {...props} kind="sources" rows={props.sources} />;
  if (props.section === "campaigns")
    return <CatalogPanel {...props} kind="campaigns" rows={props.campaigns} />;
  if (props.section === "tags")
    return <CatalogPanel {...props} kind="tags" rows={props.tags} />;
  if (props.section === "data-tools") return <DataToolsPanel {...props} />;
  if (props.section === "audit-log")
    return hasAuditLogAccess({
      roleKey: props.context?.role_key,
      teamName: props.context?.team.team_name,
    }) ? (
      <AuditLogPanel {...props} />
    ) : (
      <Empty>Leadership access is required.</Empty>
    );
  if (!projectId)
    return <Empty>Select a project to configure this section.</Empty>;
  if (props.section === "lead-configuration")
    return <LeadConfigurationPanel {...props} projectId={projectId} />;
  if (props.section === "lead-stages")
    return <StagesPanel {...props} projectId={projectId} />;
  if (props.section === "opportunity-stages")
    return <OpportunityStagesPanel {...props} projectId={projectId} />;
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

type EmailConnectionRow = {
  email_connection_id: string;
  provider: "google" | "microsoft";
  email_address: string;
  display_name: string | null;
  status: string;
  is_default: boolean;
  created_at: string;
};

function EmailAccountsPanel(props: PanelProps) {
  const router = useRouter();
  const { api } = props;
  const [connections, setConnections] = useState<EmailConnectionRow[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [connectionBusy, setConnectionBusy] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const loadConnections = useCallback(async () => {
    setLoadingConnections(true);
    try {
      const payload = await api("/api/email-connections");
      setConnections((payload.connections as EmailConnectionRow[]) ?? []);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to load email accounts",
      );
    } finally {
      setLoadingConnections(false);
    }
  }, [api]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadConnections(), 0);
    const params = new URLSearchParams(window.location.search);
    if (params.get("mailbox_connected"))
      toast.success("Email account connected");
    if (params.get("mailbox_error"))
      toast.error("Email account connection failed");
    return () => window.clearTimeout(timeout);
  }, [loadConnections]);

  useEffect(() => {
    if (!connectOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConnectOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [connectOpen]);

  const updateConnection = async (id: string, method: "PATCH" | "DELETE") => {
    setConnectionBusy(id);
    try {
      const result = await api(`/api/email-connections/accounts/${id}`, {
        method,
      });
      toast.success(String(result.message || "Email account updated"));
      await loadConnections();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to update email account",
      );
    } finally {
      setConnectionBusy(null);
    }
  };

  return (
    <div className="max-w-[980px]">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
          <div>
            <h2 className="text-sm font-semibold text-[#eef1ef]">
              Connected accounts
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-[#777f7c]">
              Choose which work mailbox Sthyra uses for lead conversations.
            </p>
          </div>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#287b63] px-3.5 text-[10px] font-semibold text-white shadow-[0_6px_18px_rgba(35,117,95,0.18)] transition hover:bg-[#309173]"
            onClick={() => setConnectOpen(true)}
            type="button"
          >
            <Plus className="size-3.5" aria-hidden />
            Connect account
          </button>
        </div>

        <div className="border-y border-white/[0.08]">
          {loadingConnections ? (
            <div className="flex min-h-24 items-center gap-2 text-[11px] text-[#737b78]">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              Loading accounts…
            </div>
          ) : connections.length ? (
            <div className="divide-y divide-white/[0.07]">
              {connections.map((connection) => (
                <div
                  className="flex min-h-[72px] flex-wrap items-center gap-3 py-3"
                  key={connection.email_connection_id}
                >
                  <span className="relative flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.05]">
                    {connection.provider === "google" ? (
                      <span className="relative size-4 overflow-hidden">
                        <Image
                          alt=""
                          fill
                          sizes="16px"
                          src="/auth/google.png"
                        />
                      </span>
                    ) : (
                      <span
                        aria-hidden
                        className="grid size-4 grid-cols-2 gap-[1.5px]"
                      >
                        <i className="bg-[#f35325]" />
                        <i className="bg-[#81bc06]" />
                        <i className="bg-[#05a6f0]" />
                        <i className="bg-[#ffba08]" />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <strong className="truncate text-[11px] font-medium text-[#e9ecea]">
                        {connection.email_address}
                      </strong>
                      <i className="size-1.5 shrink-0 rounded-full bg-[#45b892]" />
                    </span>
                    <small className="mt-1 block truncate text-[9px] text-[#69716e]">
                      {connection.provider === "google"
                        ? "Google Workspace"
                        : "Microsoft 365"}
                      {connection.display_name
                        ? ` · ${connection.display_name}`
                        : ""}
                    </small>
                  </span>
                  {connection.is_default ? (
                    <span className="inline-flex items-center gap-1.5 text-[9px] font-medium text-[#79bba5]">
                      <Star className="size-3" aria-hidden /> Default sender
                    </span>
                  ) : (
                    <button
                      className="px-2 py-1 text-[9px] font-medium text-[#9aa19e] transition hover:text-white disabled:opacity-50"
                      disabled={
                        connectionBusy === connection.email_connection_id
                      }
                      onClick={() =>
                        void updateConnection(
                          connection.email_connection_id,
                          "PATCH",
                        )
                      }
                      type="button"
                    >
                      Make default
                    </button>
                  )}
                  <button
                    aria-label={`Disconnect ${connection.email_address}`}
                    className="flex size-8 items-center justify-center rounded-lg text-[#777f7c] transition hover:bg-red-400/[0.08] hover:text-red-300 disabled:opacity-50"
                    disabled={connectionBusy === connection.email_connection_id}
                    onClick={() =>
                      void updateConnection(
                        connection.email_connection_id,
                        "DELETE",
                      )
                    }
                    title="Disconnect account"
                    type="button"
                  >
                    <Unplug className="size-3.5" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-28 items-center gap-3 py-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-[#68706d]">
                <Mail className="size-4" aria-hidden />
              </span>
              <span>
                <strong className="block text-[11px] font-medium text-[#cbd0ce]">
                  No connected mailbox
                </strong>
                <small className="mt-1 block text-[10px] text-[#69716e]">
                  Connect a work account before sending email from the CRM.
                </small>
              </span>
            </div>
          )}
        </div>
      </section>

      {connectOpen && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setConnectOpen(false);
          }}
          role="dialog"
        >
          <div className="w-full max-w-[430px] overflow-hidden rounded-2xl border border-white/[0.11] bg-[#121513] shadow-[0_30px_100px_rgba(0,0,0,0.68)]">
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-[#f2f4f3]">
                  Connect your work email
                </h3>
                <p className="mt-1 text-[10px] text-[#777f7c]">
                  Select the provider that hosts your mailbox.
                </p>
              </div>
              <button
                aria-label="Close"
                className="flex size-7 items-center justify-center rounded-lg text-[#838a87] transition hover:bg-white/[0.06] hover:text-white"
                onClick={() => setConnectOpen(false)}
                type="button"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div className="space-y-2 p-5">
              <button
                className="relative flex h-12 w-full items-center justify-center rounded-lg border border-[#d9dcda] bg-white px-12 text-[11px] font-semibold text-[#252725] transition hover:bg-[#f3f4f3]"
                onClick={() =>
                  router.push("/api/email-connections/google/start")
                }
                type="button"
              >
                <span className="absolute left-4 size-[18px] overflow-hidden">
                  <Image alt="" fill sizes="18px" src="/auth/google.png" />
                </span>
                Continue with Google
              </button>
              <button
                className="relative flex h-12 w-full items-center justify-center rounded-lg border border-white/[0.13] bg-[#1b1e1c] px-12 text-[11px] font-semibold text-[#eef1ef] transition hover:border-white/20 hover:bg-[#222624]"
                onClick={() =>
                  router.push("/api/email-connections/microsoft/start")
                }
                type="button"
              >
                <span
                  aria-hidden
                  className="absolute left-4 grid size-[17px] grid-cols-2 gap-[1.5px]"
                >
                  <i className="bg-[#f35325]" />
                  <i className="bg-[#81bc06]" />
                  <i className="bg-[#05a6f0]" />
                  <i className="bg-[#ffba08]" />
                </span>
                Continue with Microsoft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfilePanel(props: PanelProps) {
  const [form, setForm] = useState<Row>(props.user);
  const [editing, setEditing] = useState(false);
  const fullName = [
    value(props.user, "first_name"),
    value(props.user, "last_name"),
  ]
    .filter((part) => part !== "—")
    .join(" ");
  const initials =
    [props.user.first_name, props.user.last_name]
      .filter(Boolean)
      .map((part) => String(part).slice(0, 1).toUpperCase())
      .join("") || "U";
  const role =
    props.context?.role_key.replaceAll("_", " ") ?? "Workspace member";
  const shortId = String(props.user.user_id ?? "").slice(0, 8);

  const cancelEditing = () => {
    setForm(props.user);
    setEditing(false);
  };

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
    if (result?.user) {
      props.setUser(result.user as Row);
      setForm(result.user as Row);
      setEditing(false);
    }
  };

  return (
    <div className="pb-6">
      <section className="flex items-center gap-5 border-b border-white/[0.08] pb-7 max-[640px]:items-start max-[640px]:flex-wrap">
        <div className="grid size-[76px] shrink-0 place-items-center rounded-full border border-white/[0.1] bg-[linear-gradient(145deg,#286f59,#163d32)] text-xl font-semibold text-white shadow-[0_12px_30px_rgba(0,0,0,.3)]">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-[var(--font-bricolage)] text-[28px] font-semibold tracking-[-0.025em] text-[#f3f5f4]">
            {fullName || value(props.user, "username")}
          </h1>
          <p className="mt-1 text-[12px] text-[#c1c6c3] capitalize">
            {role}
            {shortId ? ` · ID: ${shortId}` : ""}
          </p>
          <p className="mt-1.5 text-[11px] text-[#747c78]">
            {props.context?.company.company_name ?? "Workspace"}
            {props.availability.timezone
              ? ` · ${String(props.availability.timezone)}`
              : ""}
          </p>
        </div>
        {!editing && (
          <button
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-[#287b63] px-4 text-xs font-semibold text-white transition hover:bg-[#319174]"
            onClick={() => setEditing(true)}
            type="button"
          >
            <Pencil className="size-3.5" aria-hidden />
            Edit details
          </button>
        )}
      </section>

      <form className="pt-7" onSubmit={submit}>
        <div className="mb-6 border-b border-white/[0.08] pb-5">
          <h2 className="font-[var(--font-bricolage)] text-lg font-semibold text-[#eef1ef]">
            Personal information
          </h2>
          <p className="mt-1 text-[12px] text-[#7b837f]">
            Keep your identity and contact details up to date.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-5 max-[720px]:grid-cols-1">
          <Field label="First name">
            <input
              disabled={!editing}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              required
              value={value(form, "first_name").replace("—", "")}
            />
          </Field>
          <Field label="Last name">
            <input
              disabled={!editing}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
              value={value(form, "last_name").replace("—", "")}
            />
          </Field>
          <Field label="Username">
            <input
              disabled={!editing}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
              value={value(form, "username").replace("—", "")}
            />
          </Field>
          <Field label="Work email">
            <input
              disabled={!editing}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              type="email"
              value={value(form, "email").replace("—", "")}
            />
          </Field>
          <Field label="Phone number">
            <input
              disabled={!editing}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              value={value(form, "phone").replace("—", "")}
            />
          </Field>
          <Field label="Company">
            <input disabled value={props.context?.company.company_name ?? ""} />
          </Field>
        </div>
        {editing && (
          <div className="mt-7 flex justify-end gap-3 border-t border-white/[0.08] pt-5">
            <button
              className={settingsUi.secondaryButton}
              disabled={props.busy}
              onClick={cancelEditing}
              type="button"
            >
              Cancel
            </button>
            <SaveButton busy={props.busy} />
          </div>
        )}
      </form>
    </div>
  );
}

function NotificationPanel(props: PanelProps) {
  const [form, setForm] = useState<Row>(props.preferences);
  const toggle = (key: string) => (checked: boolean) =>
    setForm({ ...form, [key]: checked });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      in_app_enabled: Boolean(form.in_app_enabled),
      email_enabled: Boolean(form.email_enabled),
      push_enabled: Boolean(form.push_enabled),
      lead_assignment_enabled: Boolean(form.lead_assignment_enabled),
      task_enabled: Boolean(form.task_enabled),
      appointment_enabled: Boolean(form.appointment_enabled),
      site_visit_enabled: Boolean(form.site_visit_enabled),
      opportunity_enabled: Boolean(form.opportunity_enabled),
      quotation_enabled: Boolean(form.quotation_enabled),
      booking_enabled: Boolean(form.booking_enabled),
      transfer_enabled: Boolean(form.transfer_enabled),
      follow_up_enabled: Boolean(form.follow_up_enabled),
      telephony_enabled: Boolean(form.telephony_enabled),
      digest_frequency: form.digest_frequency,
    };
    const result = await props.save(
      "/api/notification-preferences",
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
          checked={Boolean(form.email_enabled)}
          description="Receive important CRM updates by email."
          label="Email notifications"
          onChange={toggle("email_enabled")}
        />
        <Toggle
          checked={Boolean(form.in_app_enabled)}
          description="Show real-time alerts while you work."
          label="In-app notifications"
          onChange={toggle("in_app_enabled")}
        />
      </Card>
      <Card title="Operational reminders">
        <Toggle
          checked={Boolean(form.lead_assignment_enabled)}
          label="New lead assignments"
          onChange={toggle("lead_assignment_enabled")}
        />
        <Toggle
          checked={Boolean(form.task_enabled)}
          label="Task reminders"
          onChange={toggle("task_enabled")}
        />
        <Toggle
          checked={Boolean(form.appointment_enabled)}
          label="Appointment reminders"
          onChange={toggle("appointment_enabled")}
        />
        <Toggle
          checked={Boolean(form.site_visit_enabled)}
          label="Site visit updates"
          onChange={toggle("site_visit_enabled")}
        />
        <Toggle
          checked={Boolean(form.follow_up_enabled)}
          label="Overdue follow-ups"
          onChange={toggle("follow_up_enabled")}
        />
        <Toggle
          checked={Boolean(form.opportunity_enabled)}
          label="Opportunity updates"
          onChange={toggle("opportunity_enabled")}
        />
        <Toggle
          checked={Boolean(form.quotation_enabled)}
          label="Quotation updates"
          onChange={toggle("quotation_enabled")}
        />
        <Toggle
          checked={Boolean(form.booking_enabled)}
          label="Booking updates"
          onChange={toggle("booking_enabled")}
        />
        <Toggle
          checked={Boolean(form.transfer_enabled)}
          label="Transfer updates"
          onChange={toggle("transfer_enabled")}
        />
        <Toggle
          checked={Boolean(form.telephony_enabled)}
          label="Call updates"
          onChange={toggle("telephony_enabled")}
        />
        <div className="max-w-[330px]">
          <Field label="Summary digest">
            <select
              onChange={(e) =>
                setForm({ ...form, digest_frequency: e.target.value })
              }
              value={String(form.digest_frequency ?? "daily")}
            >
              <option value="never">Never</option>
              <option value="instant">Instant</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
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
  const [domainBusy, setDomainBusy] = useState(false);
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
  const retryDomain = async () => {
    setDomainBusy(true);
    try {
      const result = await props.api(
        `/api/companies/${String(props.context?.company.company_id)}/domain`,
        { method: "POST" },
      );
      toast.success(String(result.message ?? "Workspace domain updated"));
      await props.loadAll();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to provision domain",
      );
    } finally {
      setDomainBusy(false);
    }
  };
  return (
    <div className={settingsUi.stack}>
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
    <Card
      title="Workspace domain"
      description="Every company receives a dedicated CRM hostname. DNS is wildcarded; Vercel project registration is automated."
    >
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-black/15 p-4">
        <div>
          <a
            className="text-sm font-medium text-[#dfe5e2] hover:text-[#70c9aa]"
            href={`https://${String(props.company.workspace_domain ?? "")}`}
            rel="noreferrer"
            target="_blank"
          >
            {value(props.company, "workspace_domain")}
          </a>
          <p className="mt-1 text-[10px] text-[#727a77]">
            Status: {value(props.company, "workspace_domain_status")}
            {props.company.workspace_domain_error
              ? ` · ${String(props.company.workspace_domain_error)}`
              : ""}
          </p>
        </div>
        <button
          className={settingsUi.secondaryButton}
          disabled={domainBusy || !props.company.workspace_domain}
          onClick={() => void retryDomain()}
          type="button"
        >
          {domainBusy ? "Provisioning…" : "Retry provisioning"}
        </button>
      </div>
    </Card>
    </div>
  );
}

function DataToolsPanel(props: PanelProps) {
  const [entity, setEntity] = useState<"contacts" | "leads">("leads");
  const [csv, setCsv] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [chosenImportProjectId, setChosenImportProjectId] = useState<
    string | null
  >(null);
  const importProjectId =
    chosenImportProjectId ??
    String(
      props.selectedProject?.project_id ??
        props.context?.projects[0]?.project_id ??
        "",
    );
  const canExport =
    props.admin || props.context?.permissions.includes("DATA_EXPORT");
  const canImport =
    props.admin || props.context?.permissions.includes("DATA_IMPORT");

  const runImport = async (validateOnly: boolean) => {
    if (entity === "leads" && !importProjectId) {
      toast.error("Choose a destination project");
      return;
    }
    setImportBusy(true);
    try {
      const result = await props.api("/api/data/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity,
          csv,
          validate_only: validateOnly,
          ...(entity === "leads"
            ? { project_id: Number(importProjectId) }
            : {}),
        }),
      });
      toast.success(String(result.message ?? "Import processed"));
      if (!validateOnly) setCsv("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to import data");
    } finally {
      setImportBusy(false);
    }
  };
  return (
    <div className={settingsUi.stack}>
      <Card
        title="Export workspace data"
        description="Download up to 10,000 accessible records as spreadsheet-safe CSV or portable JSON."
      >
        <div className="flex flex-wrap gap-2">
          {!canExport && (
            <p className="text-xs text-[#777f7c]">Export permission is not assigned to your role.</p>
          )}
          {canExport &&
            (["contacts", "leads", "opportunities"] as const).flatMap(
              (item) =>
                (["csv", "json"] as const).map((format) => (
                  <a
                    className={settingsUi.secondaryButton}
                    href={`/api/data/export?entity=${item}&format=${format}`}
                    key={`${item}-${format}`}
                  >
                    {item} · {format.toUpperCase()}
                  </a>
                )),
            )}
        </div>
      </Card>
      <Card
        title="Import CSV"
        description="Validate first, then commit up to 1,000 contacts or leads atomically. A failed row imports nothing."
      >
        <div className={settingsUi.form}>
          <div className="max-w-[320px]">
            <Field label="Record type">
              <select value={entity} onChange={(event) => setEntity(event.target.value as typeof entity)}>
                <option value="leads">Leads</option>
                <option value="contacts">Contacts</option>
              </select>
            </Field>
          </div>
          {entity === "leads" && (
            <div className="max-w-[420px]">
              <Field label="Destination project">
                <select
                  disabled={!canImport || !props.context?.projects.length}
                  onChange={(event) =>
                    setChosenImportProjectId(event.target.value)
                  }
                  required
                  value={importProjectId}
                >
                  {!props.context?.projects.length && (
                    <option value="">No active projects available</option>
                  )}
                  {props.context?.projects.map((project) => (
                    <option
                      key={project.project_id}
                      value={project.project_id}
                    >
                      {project.project_name} ({project.project_code})
                    </option>
                  ))}
                </select>
              </Field>
              <p className="mt-2 text-[10px] leading-relaxed text-[#747c79]">
                Every imported lead will be assigned to this project. A
                project_id column is no longer required in the CSV.
              </p>
            </div>
          )}
          <input
            accept=".csv,text/csv"
            className="text-xs text-[#aeb5b2] file:mr-3 file:rounded-lg file:border file:border-white/10 file:bg-white/[0.05] file:px-3 file:py-2 file:text-[#dfe4e2]"
            disabled={!canImport}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then(setCsv);
            }}
            type="file"
          />
          <textarea
            className="min-h-48 rounded-xl border border-white/10 bg-black/25 p-4 font-mono text-[10px] text-[#d8dddb] outline-none focus:border-[#4ea98b]"
            disabled={!canImport}
            onChange={(event) => setCsv(event.target.value)}
            placeholder={
              entity === "leads"
                ? "first_name,last_name,email,phone_number,temperature,budget"
                : "first_name,last_name,email,phone_number,country"
            }
            value={csv}
          />
          <div className={settingsUi.actions}>
            <button className={settingsUi.secondaryButton} disabled={!canImport || importBusy || !csv.trim()} onClick={() => void runImport(true)} type="button">
              Validate
            </button>
            <button className={settingsUi.primaryButton} disabled={!canImport || importBusy || !csv.trim()} onClick={() => void runImport(false)} type="button">
              {importBusy ? "Processing…" : "Import data"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function AuditLogPanel(props: PanelProps) {
  const [logs, setLogs] = useState<Row[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const { api } = props;
  useEffect(() => {
    let active = true;
    void api("/api/audit-logs?limit=50")
      .then((result) => {
        if (active) setLogs((result.logs as Row[]) ?? []);
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : "Unable to load audit log");
      })
      .finally(() => {
        if (active) setLoadingLogs(false);
      });
    return () => {
      active = false;
    };
  }, [api]);
  return (
    <Card
      title="Detailed audit log"
      description="Visible only to Leadership. Secret and token fields are redacted before storage."
    >
      {loadingLogs ? (
        <div className="py-12 text-center text-xs text-[#777f7c]">Loading changes…</div>
      ) : (
        <ListTable
          rows={logs}
          columns={[
            { key: "created_at", label: "Time", render: (row) => new Date(String(row.created_at)).toLocaleString() },
            { key: "actor_name", label: "Actor" },
            { key: "action", label: "Action" },
            { key: "entity_type", label: "Entity" },
            { key: "entity_id", label: "Record" },
            {
              key: "changed_fields",
              label: "Changed fields",
              render: (row) => Array.isArray(row.changed_fields) ? row.changed_fields.join(", ") : "—",
            },
          ]}
        />
      )}
    </Card>
  );
}

function RegionsPanel(props: PanelProps) {
  const [form, setForm] = useState<Row>({
    region_type: "city",
    timezone: "Asia/Kolkata",
  });
  const regionCode = generateCodeFromName(String(form.region_name ?? ""));

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const result = await props.save(
      "/api/regions",
      "POST",
      {
        region_name: form.region_name,
        region_code: regionCode,
        region_type: form.region_type || null,
        state: form.state || null,
        latitude:
          form.latitude === "" || form.latitude === undefined
            ? null
            : Number(form.latitude),
        longitude:
          form.longitude === "" || form.longitude === undefined
            ? null
            : Number(form.longitude),
        timezone: form.timezone || null,
        is_active: true,
      },
      "Region created",
      props.loadAll,
    );
    if (result) setForm({ region_type: "city", timezone: "Asia/Kolkata" });
  };

  const toggleRegion = (row: Row) =>
    void props.save(
      `/api/regions/${String(row.region_id)}/${row.is_active ? "deactivate" : "activate"}`,
      "POST",
      {},
      `Region ${row.is_active ? "deactivated" : "activated"}`,
      props.loadAll,
    );

  return (
    <div className={settingsUi.stack}>
      <Card
        description="Regions define the markets and locations available when creating projects."
        title="Regions"
      >
        <ListTable
          columns={[
            { key: "region_name", label: "Region" },
            { key: "region_code", label: "Code" },
            { key: "state", label: "State" },
            { key: "region_type", label: "Type" },
            { key: "timezone", label: "Timezone" },
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
            {
              key: "action",
              label: "",
              render: (row) => (
                <button
                  className={settingsUi.tableAction}
                  disabled={props.busy}
                  onClick={() => toggleRegion(row)}
                  type="button"
                >
                  {row.is_active ? "Deactivate" : "Activate"}
                </button>
              ),
            },
          ]}
          rows={props.regions}
        />
      </Card>

      <Card
        description="Add a city, district, state, or sales territory before assigning projects to it."
        title="Add region"
      >
        <form className={settingsUi.form} onSubmit={create}>
          <div className={settingsUi.grid}>
            <Field label="Region name">
              <input
                onChange={(event) =>
                  setForm({ ...form, region_name: event.target.value })
                }
                placeholder="Kolkata"
                required
                value={String(form.region_name ?? "")}
              />
            </Field>
            <Field label="Region code">
              <input
                maxLength={20}
                placeholder="Generated from region name"
                readOnly
                required
                value={regionCode}
              />
            </Field>
            <Field label="Region type">
              <select
                onChange={(event) =>
                  setForm({ ...form, region_type: event.target.value })
                }
                value={String(form.region_type ?? "city")}
              >
                <option value="city">City</option>
                <option value="district">District</option>
                <option value="state">State</option>
                <option value="territory">Sales territory</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="State">
              <input
                onChange={(event) =>
                  setForm({ ...form, state: event.target.value })
                }
                placeholder="West Bengal"
                value={String(form.state ?? "")}
              />
            </Field>
            <Field label="Timezone">
              <input
                onChange={(event) =>
                  setForm({ ...form, timezone: event.target.value })
                }
                placeholder="Asia/Kolkata"
                value={String(form.timezone ?? "")}
              />
            </Field>
            <div />
            <Field label="Latitude">
              <input
                max="90"
                min="-90"
                onChange={(event) =>
                  setForm({ ...form, latitude: event.target.value })
                }
                placeholder="22.5726"
                step="any"
                type="number"
                value={String(form.latitude ?? "")}
              />
            </Field>
            <Field label="Longitude">
              <input
                max="180"
                min="-180"
                onChange={(event) =>
                  setForm({ ...form, longitude: event.target.value })
                }
                placeholder="88.3639"
                step="any"
                type="number"
                value={String(form.longitude ?? "")}
              />
            </Field>
          </div>
          <div className={settingsUi.actions}>
            <SaveButton busy={props.busy}>Add region</SaveButton>
          </div>
        </form>
      </Card>
    </div>
  );
}

function ProjectsPanel(props: PanelProps) {
  const [form, setForm] = useState<Row>({
    project_status: "planning",
    project_type: "residential",
  });
  const projectCode = generateCodeFromName(String(form.project_name ?? ""));
  const activeRegions = props.regions.filter(
    (region) => region.is_active !== false,
  );
  const selectedRegionCode = String(
    form.region_code ??
      (activeRegions.length === 1 ? activeRegions[0].region_code : ""),
  );
  const create = async (event: FormEvent) => {
    event.preventDefault();
    const result = await props.save(
      "/api/projects",
      "POST",
      {
        company_code: props.context?.company.company_code,
        region_code: selectedRegionCode,
        project_code: projectCode,
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
            { key: "project_id", label: "ID" },
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
                maxLength={20}
                placeholder="Generated from project name"
                readOnly
                required
                value={projectCode}
              />
            </Field>
            <Field label="Region">
              <select
                disabled={activeRegions.length === 0}
                onChange={(event) =>
                  setForm({ ...form, region_code: event.target.value })
                }
                required
                value={selectedRegionCode}
              >
                <option disabled value="">
                  {activeRegions.length
                    ? "Select region"
                    : "No active regions available"}
                </option>
                {activeRegions.map((region) => (
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

function ProjectMultiSelect({
  projects,
  selected,
  inherited = [],
  onChange,
}: {
  projects: Row[];
  selected: number[];
  inherited?: number[];
  onChange: (projectIds: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedSet = new Set(selected);
  const inheritedSet = new Set(inherited);
  const activeProjects = projects.filter((project) => project.is_active !== false);
  const visibleProjects = activeProjects.filter((project) => {
    const needle = search.trim().toLowerCase();
    return (
      !needle ||
      String(project.project_name ?? "").toLowerCase().includes(needle) ||
      String(project.project_code ?? "").toLowerCase().includes(needle)
    );
  });
  const totalCount = new Set([...selected, ...inherited]).size;

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.1] bg-[#0b0e0d]">
      <button
        aria-expanded={open}
        className="flex h-11 w-full items-center justify-between gap-3 px-3.5 text-left"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <FolderKanban className="size-4 shrink-0 text-[#66bea0]" strokeWidth={1.7} />
          <span className="truncate text-xs text-[#e5e9e7]">
            {totalCount
              ? `${totalCount} ${totalCount === 1 ? "project" : "projects"} selected`
              : "Choose projects"}
          </span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-[#79817e] transition ${open ? "rotate-180" : ""}`}
          strokeWidth={1.7}
        />
      </button>
      {open && (
        <div className="border-t border-white/[0.08]">
          <div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-2.5">
            <Search className="size-3.5 text-[#69716e]" strokeWidth={1.8} />
            <input
              className="min-w-0 flex-1 border-0 bg-transparent text-[11px] text-white outline-none placeholder:text-[#59605e]"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a project"
              value={search}
            />
            <button
              className="text-[9px] font-medium text-[#69c4a4] hover:text-[#8bd7bc]"
              onClick={() =>
                onChange(
                  activeProjects
                    .map((project) => Number(project.project_id))
                    .filter((projectId) => !inheritedSet.has(projectId)),
                )
              }
              type="button"
            >
              Select all
            </button>
            {selected.length > 0 && (
              <button
                className="text-[9px] text-[#828a87] hover:text-white"
                onClick={() => onChange([])}
                type="button"
              >
                Clear
              </button>
            )}
          </div>
          <div className="max-h-52 overflow-y-auto p-1.5 [scrollbar-width:thin]">
            {visibleProjects.map((project) => {
              const projectId = Number(project.project_id);
              const isInherited = inheritedSet.has(projectId);
              const checked = selectedSet.has(projectId) || isInherited;
              return (
                <button
                  aria-pressed={checked}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${
                    checked ? "bg-[#173c31]/65" : "hover:bg-white/[0.04]"
                  } ${isInherited ? "cursor-default" : ""}`}
                  key={projectId}
                  onClick={() => {
                    if (isInherited) return;
                    onChange(
                      selectedSet.has(projectId)
                        ? selected.filter((id) => id !== projectId)
                        : [...selected, projectId],
                    );
                  }}
                  type="button"
                >
                  <span
                    className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                      checked
                        ? "border-[#4daf8e] bg-[#369274] text-white"
                        : "border-white/20 bg-black/20"
                    }`}
                  >
                    {checked && <Check className="size-3" strokeWidth={2.5} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-[#e0e5e2]">
                      {value(project, "project_name")}
                    </span>
                    <span className="mt-0.5 block truncate text-[9px] text-[#6f7774]">
                      {value(project, "project_code")}
                    </span>
                  </span>
                  {isInherited && (
                    <span className="shrink-0 text-[9px] text-[#6fb99f]">Via team</span>
                  )}
                </button>
              );
            })}
            {!visibleProjects.length && (
              <p className="px-3 py-6 text-center text-[10px] text-[#68706d]">
                No projects found.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PeoplePanel(props: PanelProps) {
  const [mode, setMode] = useState<"user" | "team" | "role">("user");
  const [form, setForm] = useState<Row>({ is_active: true, project_ids: [] });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [invitationActionBusy, setInvitationActionBusy] = useState<
    string | null
  >(null);
  const [permissionRole, setPermissionRole] = useState<Row | null>(null);
  const [availablePermissions, setAvailablePermissions] = useState<Row[]>([]);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<Set<string>>(
    new Set(),
  );
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [projectAccess, setProjectAccess] = useState<{
    kind: "user" | "team";
    id: string;
    name: string;
    selected: number[];
    inherited: number[];
  } | null>(null);
  const [projectAccessBusy, setProjectAccessBusy] = useState(false);

  useEffect(() => {
    if (!dialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialogOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [dialogOpen]);

  useEffect(() => {
    if (!permissionRole) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPermissionRole(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [permissionRole]);

  const openCreate = () => {
    setForm({ is_active: true, project_ids: [] });
    setDialogOpen(true);
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    let url = "/api/invitations";
    let payload: Row = {
      email: form.email,
      role_id: form.role_id,
      team_id: form.team_id,
      project_ids: form.project_ids ?? [],
    };
    if (mode === "team") {
      url = "/api/teams";
      payload = {
        company_id: props.context?.company.company_id,
        name: form.name,
        team_type: form.team_type,
        description: form.description || null,
        ...(canManageProjectAccess
          ? { project_ids: form.project_ids ?? [] }
          : {}),
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
      mode === "user" ? "Invitation created" : `${mode} created`,
      mode === "user" ? undefined : props.loadAll,
    );
    if (result) {
      if (mode === "user") {
        const invitation = result.invitation;
        if (
          invitation &&
          typeof invitation === "object" &&
          !Array.isArray(invitation)
        ) {
          const invitationRow = invitation as Row;
          props.setInvitations((current) => [
            invitationRow,
            ...current.filter(
              (row) =>
                String(row.invitation_id) !==
                String(invitationRow.invitation_id),
            ),
          ]);
          setPendingOpen(true);
        }
      }
      setForm({ is_active: true, project_ids: [] });
      setDialogOpen(false);
    }
  };

  const roleName = (row: Row) =>
    value(
      props.roles.find(
        (role) => String(role.role_id) === String(row.role_id),
      ) ?? {},
      "role_name",
    );
  const teamName = (row: Row) =>
    row.team_id
      ? value(
          props.teams.find(
            (team) => String(team.team_id) === String(row.team_id),
          ) ?? {},
          "name",
        )
      : "No team";
  const currentTeam = props.teams.find(
    (team) => String(team.team_id) === String(props.user.team_id),
  );
  const canManageProjectAccess =
    isLeadershipTeamName(currentTeam?.name);
  const selectedRole = props.roles.find(
    (role) => String(role.role_id) === String(form.role_id),
  );
  const companyWideInvitation = isCompanyWideProjectRole(
    selectedRole?.role_key,
  );
  const selectedFormProjects = Array.isArray(form.project_ids)
    ? form.project_ids.map(Number).filter(Number.isSafeInteger)
    : [];
  const invitationProjectNames = (row: Row) => {
    if (!Array.isArray(row.projects) || row.projects.length === 0) {
      return isCompanyWideProjectRole(row.role_key)
        ? "Company-wide"
        : "No projects";
    }
    return row.projects
      .map((project) =>
        typeof project === "object" && project !== null
          ? String((project as Row).project_name ?? "")
          : "",
      )
      .filter(Boolean)
      .join(", ");
  };
  const openProjectAccess = async (kind: "user" | "team", row: Row) => {
    if (!canManageProjectAccess) return;
    const id = String(kind === "user" ? row.user_id : row.team_id);
    setProjectAccessBusy(true);
    try {
      const directRequest = props.api(
        `/api/${kind === "user" ? "users" : "teams"}/${id}/projects`,
      );
      const [direct, effective] = await Promise.all([
        directRequest,
        kind === "user"
          ? props.api(`/api/users/${id}/effective-projects`)
          : Promise.resolve({ projects: [] }),
      ]);
      const directIds = ((direct.projects as Row[]) ?? []).map((project) =>
        Number(project.project_id),
      );
      const effectiveIds = ((effective.projects as Row[]) ?? []).map((project) =>
        Number(project.project_id),
      );
      setProjectAccess({
        kind,
        id,
        name: kind === "user" ? displayName(row) : String(row.name ?? "Team"),
        selected: directIds,
        inherited: effectiveIds.filter((projectId) => !directIds.includes(projectId)),
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load project access",
      );
    } finally {
      setProjectAccessBusy(false);
    }
  };
  const saveProjectAccess = async () => {
    if (!projectAccess) return;
    setProjectAccessBusy(true);
    try {
      await props.api(
        `/api/${projectAccess.kind === "user" ? "users" : "teams"}/${projectAccess.id}/projects`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_ids: projectAccess.selected }),
        },
      );
      toast.success(
        `${projectAccess.kind === "user" ? "Member" : "Team"} project access updated`,
      );
      setProjectAccess(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save project access",
      );
    } finally {
      setProjectAccessBusy(false);
    }
  };
  const displayName = (row: Row) =>
    `${String(row.first_name ?? "")} ${String(row.last_name ?? "")}`.trim() ||
    String(row.username ?? row.email ?? "Unnamed member");
  const formatDate = (input: unknown) => {
    if (!input) return "—";
    const date = new Date(String(input));
    return Number.isNaN(date.getTime())
      ? "—"
      : new Intl.DateTimeFormat("en", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(date);
  };
  const invitationAction = async (
    invitationId: string,
    action: "link" | "resend" | "revoke" | "expire",
  ) => {
    const key = `${invitationId}:${action}`;
    setInvitationActionBusy(key);
    try {
      const result = await props.api(
        `/api/invitations/${invitationId}/${action}`,
        { method: "POST" },
      );
      if (action === "link") {
        const link = String(result.invitation_url ?? "");
        if (!link)
          throw new Error("The server did not return an invitation link");
        await navigator.clipboard.writeText(link);
      }
      toast.success(String(result.message ?? "Invitation updated"));
      await props.loadAll();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to update invitation",
      );
    } finally {
      setInvitationActionBusy(null);
    }
  };
  const openPermissions = async (role: Row) => {
    if (role.is_system_role) return;
    setPermissionBusy(true);
    try {
      const roleId = String(role.role_id);
      const [catalog, assigned] = await Promise.all([
        props.api("/api/permissions"),
        props.api(`/api/roles/${roleId}/permissions`),
      ]);
      setAvailablePermissions((catalog.permissions as Row[]) ?? []);
      setSelectedPermissionIds(
        new Set(
          ((assigned.permissions as Row[]) ?? []).map((permission) =>
            String(permission.permission_id),
          ),
        ),
      );
      setPermissionRole(role);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load permissions",
      );
    } finally {
      setPermissionBusy(false);
    }
  };
  const savePermissions = async () => {
    if (!permissionRole) return;
    setPermissionBusy(true);
    try {
      await props.api(
        `/api/roles/${String(permissionRole.role_id)}/permissions`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            permission_ids: [...selectedPermissionIds],
          }),
        },
      );
      toast.success("Role permissions updated");
      setPermissionRole(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save permissions",
      );
    } finally {
      setPermissionBusy(false);
    }
  };
  const pendingInvitations = props.invitations;
  const memberUsers = props.users;
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (row: Row) =>
    !normalizedQuery ||
    Object.values(row).some((item) =>
      String(item ?? "")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  const visibleUsers = memberUsers.filter(
    (row) =>
      matchesQuery(row) &&
      (status === "all" ||
        (status === "active"
          ? row.is_active !== false
          : row.is_active === false)),
  );
  const visibleTeams = props.teams.filter(matchesQuery);
  const visibleRoles = props.roles.filter(matchesQuery);
  const formatPermissionLabel = (input: unknown) =>
    String(input ?? "—")
      .toLowerCase()
      .replaceAll("_", " ")
      .replace(/\b\w/g, (character) => character.toUpperCase());
  const inputClass =
    "h-11 w-full rounded-xl border border-white/10 bg-[#0b0e0d] px-3.5 text-xs text-[#f0f0f0] outline-none transition placeholder:text-white/25 focus:border-[#4ea98b] focus:ring-2 focus:ring-[#4ea98b]/15";
  const dialogTitle =
    mode === "user"
      ? "Invite teammate"
      : mode === "team"
        ? "Create team"
        : "Create role";

  return (
    <div className="p-6 sm:p-8">
      <div className="mb-6">
        <h1 className="font-[var(--font-bricolage)] text-[28px] font-medium tracking-[-0.02em] text-[#f1f4f3]">
          Members
        </h1>
        <p className="mt-1 text-[12px] text-[#858c89]">
          Manage workspace access, teams, and roles.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex w-max min-w-0 overflow-x-auto rounded-[10px] border border-[#2c2c2c] bg-[#191919] p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              ["user", "People", props.users.length],
              ["team", "Teams", props.teams.length],
              ["role", "Roles", props.roles.length],
            ] as const
          ).map(([itemMode, label, count]) => (
            <button
              className={`h-9 shrink-0 rounded-[7px] border-0 px-3.5 text-xs whitespace-nowrap transition ${
                mode === itemMode
                  ? "bg-[#3b3b3b] text-[#f5f5f5]"
                  : "bg-transparent text-[#b4b4b4]"
              }`}
              key={itemMode}
              onClick={() => {
                setMode(itemMode);
                setQuery("");
                setStatus("all");
              }}
              type="button"
            >
              {label}
              <span
                className={`ml-2 text-[10px] ${
                  mode === itemMode ? "text-[#aeb2b1]" : "text-[#707472]"
                }`}
              >
                {count}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 max-[640px]:w-full max-[640px]:justify-start">
          <label className="flex h-9 w-[230px] items-center gap-2 rounded-lg border border-white/10 bg-black/15 px-3 text-[#747c79] max-[520px]:w-full">
            <Search
              aria-hidden
              className="size-3.5 shrink-0"
              strokeWidth={1.8}
            />
            <input
              className="min-w-0 flex-1 border-0 bg-transparent text-[11px] text-white outline-none placeholder:text-[#59605e]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${mode === "user" ? "members" : `${mode}s`}...`}
              value={query}
            />
          </label>
          {mode === "user" && (
            <div className="relative">
              <select
                aria-label="Filter members by status"
                className="h-9 appearance-none rounded-lg border border-white/10 bg-[#151918] py-0 pr-9 pl-3 text-[10px] text-[#b9bfbd] outline-none focus:border-[#4ea98b]"
                onChange={(event) => setStatus(event.target.value)}
                value={status}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <ChevronDown
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-[#8e9693]"
                strokeWidth={1.8}
              />
            </div>
          )}
          <button
            className="inline-flex h-9 items-center justify-center rounded-lg border border-[#3a9e7e] bg-[#2c8a6e] px-4 text-[10px] font-semibold text-white transition hover:bg-[#35a080] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-[#69716e]"
            disabled={mode === "user" && !canManageProjectAccess}
            onClick={openCreate}
            title={
              mode === "user" && !canManageProjectAccess
                ? "Only Leadership team members can invite people and configure project access"
                : undefined
            }
            type="button"
          >
            +{" "}
            {mode === "user"
              ? "Invite teammate"
              : mode === "team"
                ? "Create team"
                : "Create role"}
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0c0f0e]">
        <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {mode === "user" && (
            <table className="w-full min-w-[920px] border-collapse text-left">
              <thead className="bg-white/[0.018] text-[9px] font-semibold tracking-[0.04em] text-[#737b78]">
                <tr className="border-b border-white/[0.08]">
                  <th className="px-4 py-3.5">Full name</th>
                  <th className="px-4 py-3.5">Username</th>
                  <th className="px-4 py-3.5">Email</th>
                  <th className="px-4 py-3.5">Role</th>
                  <th className="px-4 py-3.5">Team</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Joining date</th>
                  {canManageProjectAccess && (
                    <th className="px-4 py-3.5">Project access</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((row, index) => (
                  <tr
                    className="border-b border-white/[0.06] text-[11px] text-[#b8bebc] transition last:border-0 hover:bg-white/[0.02]"
                    key={String(row.user_id ?? index)}
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1f5c49] text-[9px] font-semibold text-[#c5eee0]">
                          {displayName(row).slice(0, 1).toUpperCase()}
                        </span>
                        <strong className="font-medium text-[#e2e5e4]">
                          {displayName(row)}
                        </strong>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">{value(row, "username")}</td>
                    <td className="px-4 py-3.5">{value(row, "email")}</td>
                    <td className="px-4 py-3.5">{roleName(row)}</td>
                    <td className="px-4 py-3.5">{teamName(row)}</td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`${settingsUi.status} ${row.is_active !== false ? settingsUi.statusOn : ""}`}
                      >
                        {row.is_active !== false ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {formatDate(row.created_at)}
                    </td>
                    {canManageProjectAccess && (
                      <td className="px-4 py-3.5">
                        {isCompanyWideProjectRole(
                          props.roles.find(
                            (role) =>
                              String(role.role_id) === String(row.role_id),
                          )?.role_key,
                        ) ? (
                          <span className="text-[10px] text-[#69a993]">
                            Company-wide
                          </span>
                        ) : (
                          <button
                            className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] text-[#b9bfbd] transition hover:border-[#4ea98b]/60 hover:text-white disabled:opacity-40"
                            disabled={projectAccessBusy}
                            onClick={() => void openProjectAccess("user", row)}
                            type="button"
                          >
                            Manage
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {!visibleUsers.length && (
                  <tr>
                    <td
                      className="px-4 py-12 text-center text-[11px] text-[#646c69]"
                      colSpan={canManageProjectAccess ? 8 : 7}
                    >
                      No members match your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {mode === "team" && (
            <ListTable
              rows={visibleTeams}
              columns={[
                { key: "name", label: "Team" },
                { key: "team_type", label: "Type" },
                { key: "description", label: "Description" },
                {
                  key: "is_active",
                  label: "Status",
                  render: (row) => (
                    <span
                      className={`${settingsUi.status} ${row.is_active !== false ? settingsUi.statusOn : ""}`}
                    >
                      {row.is_active !== false ? "Active" : "Inactive"}
                    </span>
                  ),
                },
                ...(canManageProjectAccess
                  ? [
                      {
                        key: "project_access",
                        label: "Project access",
                        render: (row: Row) => (
                          <button
                            className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] text-[#b9bfbd] transition hover:border-[#4ea98b]/60 hover:text-white disabled:opacity-40"
                            disabled={projectAccessBusy}
                            onClick={() => void openProjectAccess("team", row)}
                            type="button"
                          >
                            Manage
                          </button>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          )}
          {mode === "role" && (
            <ListTable
              rows={visibleRoles}
              columns={[
                { key: "role_name", label: "Role" },
                { key: "role_key", label: "Key" },
                { key: "description", label: "Description" },
                {
                  key: "is_system_role",
                  label: "Type",
                  render: (row) => (row.is_system_role ? "System" : "Custom"),
                },
                {
                  key: "role_id",
                  label: "Permissions",
                  render: (row) =>
                    row.is_system_role ? (
                      <span className="text-[10px] text-[#69716e]">
                        Managed by Sthyra
                      </span>
                    ) : (
                      <button
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] text-[#b9bfbd] transition hover:border-[#4ea98b]/60 hover:text-white"
                        disabled={permissionBusy}
                        onClick={() => void openPermissions(row)}
                        type="button"
                      >
                        Customize
                      </button>
                    ),
                },
              ]}
            />
          )}
        </div>
      </div>

      {mode === "user" && (
        <section className="mt-7 border-t border-white/[0.08] pt-5">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setPendingOpen((open) => !open)}
            type="button"
          >
            <span className="flex items-center gap-2.5">
              <strong className="text-sm font-medium text-[#e7eae9]">
                Pending invitations
              </strong>
              <span className="rounded-full bg-[#153c30] px-2 py-0.5 text-[9px] font-semibold text-[#6bc4a5]">
                {pendingInvitations.length}
              </span>
            </span>
            <ChevronDown
              aria-hidden
              className={`size-4 text-[#777f7c] transition-transform ${pendingOpen ? "rotate-180" : ""}`}
              strokeWidth={1.8}
            />
          </button>
          {pendingOpen && (
            <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.07] bg-black/10">
              {pendingInvitations.length ? (
                pendingInvitations.map((row, index) => (
                  <div
                    className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-0"
                    key={String(row.invitation_id ?? index)}
                  >
                    <span className="flex size-7 items-center justify-center rounded-lg bg-white/[0.06] text-[9px] text-[#9da4a1]">
                      {String(row.email ?? "?")
                        .slice(0, 1)
                        .toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[#d2d6d4]">
                      {value(row, "email")}
                    </span>
                    <span className="text-[10px] text-[#747c79]">
                      {value(row, "role_name")}
                    </span>
                    <span className="text-[10px] text-[#747c79]">
                      {value(row, "team_name")}
                    </span>
                    <span
                      className="max-w-48 truncate text-[10px] text-[#747c79]"
                      title={invitationProjectNames(row)}
                    >
                      {invitationProjectNames(row)}
                    </span>
                    <span className="text-[9px] text-[#626a67]">
                      Expires {formatDate(row.expires_at)}
                    </span>
                    <span className="rounded-md bg-amber-500/10 px-2 py-1 text-[9px] font-semibold text-amber-300/80">
                      Pending
                    </span>
                    <div className="flex items-center gap-1 border-l border-white/[0.07] pl-2">
                      {(
                        [
                          ["link", Copy, "Generate and copy a fresh link"],
                          ["resend", Mail, "Resend invitation email"],
                          ["expire", TimerOff, "Expire invitation now"],
                          ["revoke", Ban, "Revoke invitation"],
                        ] as const
                      ).map(([action, Icon, label]) => {
                        const actionKey = `${String(row.invitation_id)}:${action}`;
                        return (
                          <button
                            aria-label={label}
                            className="flex size-7 items-center justify-center rounded-md text-[#79817e] transition hover:bg-white/[0.06] hover:text-[#69c4a4] disabled:opacity-40"
                            disabled={invitationActionBusy !== null}
                            key={action}
                            onClick={() =>
                              void invitationAction(
                                String(row.invitation_id),
                                action,
                              )
                            }
                            title={label}
                            type="button"
                          >
                            {invitationActionBusy === actionKey ? (
                              <LoaderCircle
                                aria-hidden
                                className="size-3.5 animate-spin"
                              />
                            ) : (
                              <Icon
                                aria-hidden
                                className="size-3.5"
                                strokeWidth={1.8}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-7 text-center text-[10px] text-[#626a67]">
                  No pending invitations.
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {dialogOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-[3px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setDialogOpen(false);
          }}
        >
          <section
            aria-labelledby="people-dialog-title"
            aria-modal="true"
            className="max-h-[calc(100dvh-32px)] w-full max-w-[620px] overflow-y-auto rounded-2xl border border-white/[0.12] bg-[#111513] shadow-[0_30px_100px_rgba(0,0,0,0.65)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="dialog"
          >
            <header className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-6 py-5">
              <div>
                <h2
                  className="font-[var(--font-bricolage)] text-xl font-medium text-white"
                  id="people-dialog-title"
                >
                  {dialogTitle}
                </h2>
                <p className="mt-1 text-[10px] text-[#777f7c]">
                  {mode === "user"
                    ? "Choose their role, team, and the projects they can work in."
                    : mode === "team"
                      ? "Create a team and define its shared project access."
                      : "Configure the workspace access structure."}
                </p>
              </div>
              <button
                aria-label="Close dialog"
                className="flex size-8 items-center justify-center rounded-lg text-lg text-[#858c89] transition hover:bg-white/[0.06] hover:text-white"
                onClick={() => setDialogOpen(false)}
                type="button"
              >
                <X aria-hidden className="size-4" strokeWidth={1.8} />
              </button>
            </header>
            <form onSubmit={create}>
              <div className="grid grid-cols-2 gap-4 p-6 max-[560px]:grid-cols-1">
                {mode === "user" && (
                  <>
                    <div className="col-span-2 max-[560px]:col-span-1">
                      <Field label="Email address">
                        <input
                          required
                          className={inputClass}
                          type="email"
                          onChange={(e) =>
                            setForm({ ...form, email: e.target.value })
                          }
                          value={String(form.email ?? "")}
                        />
                      </Field>
                    </div>
                    <Field label="Role">
                      <select
                        required
                        className={inputClass}
                        onChange={(e) => {
                          const role = props.roles.find(
                            (item) => String(item.role_id) === e.target.value,
                          );
                          setForm({
                            ...form,
                            role_id: e.target.value,
                            ...(isCompanyWideProjectRole(role?.role_key)
                              ? { project_ids: [] }
                              : {}),
                          });
                        }}
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
                        required
                        className={inputClass}
                        onChange={(e) =>
                          setForm({ ...form, team_id: e.target.value || null })
                        }
                        value={String(form.team_id ?? "")}
                      >
                        <option value="">Select team</option>
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
                    <div className="col-span-2 max-[560px]:col-span-1">
                      <Field label="Project access">
                        {companyWideInvitation ? (
                          <div className="flex h-11 items-center gap-2.5 rounded-xl border border-[#4ea98b]/20 bg-[#173c31]/35 px-3.5 text-[11px] text-[#9fd4c1]">
                            <CheckCircle2 className="size-4" strokeWidth={1.8} />
                            This role has company-wide project access.
                          </div>
                        ) : (
                          <ProjectMultiSelect
                            onChange={(projectIds) =>
                              setForm({ ...form, project_ids: projectIds })
                            }
                            projects={props.projects}
                            selected={selectedFormProjects}
                          />
                        )}
                      </Field>
                      {!companyWideInvitation && selectedFormProjects.length === 0 && (
                        <p className="mt-1.5 text-[9px] text-[#777f7c]">
                          Select at least one project so this teammate can see CRM data.
                        </p>
                      )}
                    </div>
                  </>
                )}
                {mode === "team" && (
                  <>
                    <Field label="Team name">
                      <input
                        required
                        className={inputClass}
                        onChange={(e) =>
                          setForm({ ...form, name: e.target.value })
                        }
                        value={String(form.name ?? "")}
                      />
                    </Field>
                    <Field label="Team type">
                      <input
                        required
                        className={inputClass}
                        onChange={(e) =>
                          setForm({ ...form, team_type: e.target.value })
                        }
                        placeholder="sales"
                        value={String(form.team_type ?? "")}
                      />
                    </Field>
                    <div className="col-span-2 max-[560px]:col-span-1">
                      <Field label="Description">
                        <input
                          className={inputClass}
                          onChange={(e) =>
                            setForm({ ...form, description: e.target.value })
                          }
                          value={String(form.description ?? "")}
                        />
                      </Field>
                    </div>
                    {canManageProjectAccess && (
                      <div className="col-span-2 max-[560px]:col-span-1">
                        <Field label="Shared project access">
                          <ProjectMultiSelect
                            onChange={(projectIds) =>
                              setForm({ ...form, project_ids: projectIds })
                            }
                            projects={props.projects}
                            selected={selectedFormProjects}
                          />
                        </Field>
                        <p className="mt-1.5 text-[9px] text-[#777f7c]">
                          Every member of this team inherits these projects.
                        </p>
                      </div>
                    )}
                  </>
                )}
                {mode === "role" && (
                  <>
                    <Field label="Role name">
                      <input
                        required
                        className={inputClass}
                        onChange={(e) =>
                          setForm({ ...form, role_name: e.target.value })
                        }
                        value={String(form.role_name ?? "")}
                      />
                    </Field>
                    <Field label="Role key">
                      <input
                        required
                        className={inputClass}
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
                    <div className="col-span-2 max-[560px]:col-span-1">
                      <Field label="Description">
                        <input
                          className={inputClass}
                          onChange={(e) =>
                            setForm({ ...form, description: e.target.value })
                          }
                          value={String(form.description ?? "")}
                        />
                      </Field>
                    </div>
                  </>
                )}
              </div>
              <footer className="flex items-center justify-end gap-2 border-t border-white/[0.08] bg-black/10 px-6 py-4">
                <button
                  className={settingsUi.secondaryButton}
                  onClick={() => setDialogOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className={settingsUi.primaryButton}
                  disabled={
                    props.busy ||
                    (mode === "user" &&
                      !companyWideInvitation &&
                      selectedFormProjects.length === 0)
                  }
                  type="submit"
                >
                  {props.busy ? "Saving…" : dialogTitle}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {projectAccess && (
        <div
          className="fixed inset-0 z-[115] flex items-center justify-center bg-black/80 p-4 backdrop-blur-[3px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setProjectAccess(null);
          }}
        >
          <section
            aria-labelledby="project-access-dialog-title"
            aria-modal="true"
            className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-white/[0.12] bg-[#111513] shadow-[0_30px_100px_rgba(0,0,0,0.7)]"
            role="dialog"
          >
            <header className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-6 py-5">
              <div className="min-w-0">
                <h2
                  className="font-[var(--font-bricolage)] text-xl font-medium text-white"
                  id="project-access-dialog-title"
                >
                  Project access
                </h2>
                <p className="mt-1 text-[10px] text-[#777f7c]">
                  Choose which projects {projectAccess.name} can work in.
                </p>
              </div>
              <button
                aria-label="Close project access editor"
                className="flex size-8 items-center justify-center rounded-lg text-[#858c89] hover:bg-white/[0.06] hover:text-white"
                onClick={() => setProjectAccess(null)}
                type="button"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="p-6">
              <ProjectMultiSelect
                inherited={projectAccess.inherited}
                onChange={(selected) =>
                  setProjectAccess((current) =>
                    current ? { ...current, selected } : current,
                  )
                }
                projects={props.projects}
                selected={projectAccess.selected}
              />
              {projectAccess.kind === "user" && projectAccess.inherited.length > 0 && (
                <p className="mt-3 text-[10px] leading-5 text-[#777f7c]">
                  Projects marked “Via team” are inherited from the member’s team.
                  Change them from the Teams tab.
                </p>
              )}
            </div>
            <footer className="flex items-center justify-between gap-3 border-t border-white/[0.08] bg-black/10 px-6 py-4">
              <span className="text-[10px] text-[#777f7c]">
                {new Set([
                  ...projectAccess.selected,
                  ...projectAccess.inherited,
                ]).size}{" "}
                projects available
              </span>
              <div className="flex gap-2">
                <button
                  className={settingsUi.secondaryButton}
                  onClick={() => setProjectAccess(null)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className={settingsUi.primaryButton}
                  disabled={projectAccessBusy}
                  onClick={() => void saveProjectAccess()}
                  type="button"
                >
                  {projectAccessBusy ? "Saving…" : "Save access"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
      {permissionRole && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-[3px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setPermissionRole(null);
          }}
        >
          <section
            aria-labelledby="permission-dialog-title"
            aria-modal="true"
            className="flex max-h-[calc(100dvh-32px)] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#101311] shadow-[0_30px_100px_rgba(0,0,0,0.72)]"
            role="dialog"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.08] px-6 py-5">
              <div className="min-w-0">
                <h2
                  className="font-[var(--font-bricolage)] text-xl font-medium text-white"
                  id="permission-dialog-title"
                >
                  Add permissions
                </h2>
                <p className="mt-1 text-[10px] text-[#777f7c]">
                  Choose permission policies for{" "}
                  <span className="font-medium text-[#dce2df]">
                    {value(permissionRole, "role_name")}
                  </span>
                  .
                </p>
              </div>
              <button
                aria-label="Close permission editor"
                className="flex size-8 items-center justify-center rounded-lg text-[#858c89] hover:bg-white/[0.06] hover:text-white"
                onClick={() => setPermissionRole(null)}
                type="button"
              >
                <X aria-hidden className="size-4" />
              </button>
            </header>
            <div className="shrink-0 border-b border-white/[0.08] px-6 py-4">
              <h3 className="text-[13px] font-semibold text-[#edf1ef]">
                Permission policies{" "}
                <span className="font-normal text-[#858d89]">
                  ({selectedPermissionIds.size}/{availablePermissions.length})
                </span>
              </h3>
              <p className="mt-1 text-[10px] text-[#747c79]">
                Choose one or more policies to attach to this role.
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-[#0b0e0c]">
              <table className="w-full min-w-[680px] table-fixed border-collapse text-left">
                <colgroup>
                  <col className="w-12" />
                  <col className="w-[52%]" />
                  <col className="w-[25%]" />
                  <col />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-[#171b19] shadow-[0_1px_0_rgba(255,255,255,0.09)]">
                  <tr className="h-10 text-[9px] font-semibold tracking-[0.05em] text-[#959d99] uppercase">
                    <th aria-label="Selection" className="px-4" />
                    <th className="px-3 font-semibold">Policy name</th>
                    <th className="border-l border-white/[0.07] px-4 font-semibold">
                      Module
                    </th>
                    <th className="border-l border-white/[0.07] px-4 font-semibold">
                      Access
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {availablePermissions.map((permission) => {
                    const permissionId = String(permission.permission_id);
                    const checked = selectedPermissionIds.has(permissionId);
                    return (
                      <tr
                        className="h-[58px] border-b border-white/[0.07] bg-transparent transition hover:bg-white/[0.025]"
                        key={permissionId}
                      >
                        <td className="px-4 align-middle">
                          <input
                            aria-label={"Select " + value(permission, "permission_name")}
                            checked={checked}
                            className="size-3.5 cursor-pointer accent-[#56b997]"
                            onChange={(event) => {
                              const next = new Set(selectedPermissionIds);
                              if (event.target.checked) next.add(permissionId);
                              else next.delete(permissionId);
                              setSelectedPermissionIds(next);
                            }}
                            type="checkbox"
                          />
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <span className="block truncate text-[11px] font-medium text-[#e7ece9]">
                            {value(permission, "permission_name")}
                          </span>
                          <span className="mt-1 block truncate text-[9px] text-[#707875]">
                            {value(permission, "description")}
                          </span>
                        </td>
                        <td className="border-l border-white/[0.05] px-4 align-middle">
                          <span className="text-[10px] text-[#b7bfbb]">
                            {formatPermissionLabel(permission.feature_key)}
                          </span>
                        </td>
                        <td className="border-l border-white/[0.05] px-4 align-middle">
                          <span className="inline-flex rounded-md border border-white/[0.08] bg-white/[0.035] px-2 py-1 text-[9px] font-medium text-[#aeb6b2]">
                            {formatPermissionLabel(permission.action)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {availablePermissions.length === 0 && (
                    <tr>
                      <td className="h-40 px-6 text-center" colSpan={4}>
                        <p className="text-[11px] text-[#7c8480]">
                          No permission policies are available.
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.08] bg-[#131714] px-6 py-4">
              <span aria-live="polite" className="text-[10px] text-[#7f8783]">
                {selectedPermissionIds.size}{" "}
                {selectedPermissionIds.size === 1 ? "policy" : "policies"} selected
              </span>
              <div className="flex gap-2">
                <button
                  className={settingsUi.secondaryButton}
                  onClick={() => setPermissionRole(null)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className={settingsUi.primaryButton}
                  disabled={permissionBusy}
                  onClick={() => void savePermissions()}
                  type="button"
                >
                  {permissionBusy ? "Saving…" : "Save permissions"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
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
      duplicate_check_enabled: Boolean(form.duplicate_check_enabled),
      duplicate_window_days: Number(form.duplicate_window_days),
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
          description="Use active routing rules and queue members to choose an owner for each new lead."
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
        <p className="mt-3 text-[10px] leading-relaxed text-[#737b78]">
          Distribution is configured under Queues and Routing rules. Response
          targets are configured under SLA rules.
        </p>
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
  description,
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
  description?: string;
  items: Row[];
  onAdd: () => void;
  onChange: (index: number, key: string, value: unknown) => void;
  onRemove: (index: number) => void;
  onSave: () => void;
  title: string;
}) {
  return (
    <Card description={description} title={title}>
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

type StageEditorColumn = {
  key: string;
  label: string;
  type?: "text" | "checkbox";
};

function StageDefinitionEditor({
  addLabel,
  busy,
  columns,
  description,
  items,
  kind,
  onAdd,
  onChange,
  onRemove,
  onSave,
  title,
}: {
  addLabel: string;
  busy: boolean;
  columns: StageEditorColumn[];
  description: string;
  items: Row[];
  kind: "lead" | "opportunity";
  onAdd: () => void;
  onChange: (index: number, key: string, value: unknown) => void;
  onRemove: (index: number) => void;
  onSave: () => void;
  title: string;
}) {
  const grid =
    kind === "lead"
      ? "lg:grid-cols-[56px_minmax(220px,1.2fr)_minmax(190px,1fr)_100px_100px_52px]"
      : "lg:grid-cols-[56px_minmax(180px,1.1fr)_minmax(160px,1fr)_120px_160px_100px_52px]";

  return (
    <Card description={description} title={title}>
      <div className="overflow-hidden rounded-xl border border-white/[0.09] bg-[#0a0d0c]">
        <div
          className={`hidden min-h-10 items-center border-b border-white/[0.08] bg-white/[0.025] text-[10px] font-medium text-[#858d8a] lg:grid ${grid}`}
        >
          <span className="px-4 text-center">Order</span>
          {columns.map((column) => (
            <span
              className={
                column.type === "checkbox" ? "text-center" : "px-3"
              }
              key={column.key}
            >
              {column.label}
            </span>
          ))}
          <span className="sr-only">Actions</span>
        </div>

        <div className="divide-y divide-white/[0.07]">
          {items.map((item, index) => (
            <div
              className={`grid grid-cols-2 gap-3 px-4 py-4 transition-colors hover:bg-white/[0.018] lg:items-stretch lg:gap-0 lg:px-0 lg:py-0 ${grid}`}
              key={String(
                item.stage_id ?? item.field_id ?? item.reason_id ?? index,
              )}
            >
              <div className="col-span-2 flex items-center justify-between lg:col-span-1 lg:min-h-16 lg:justify-center lg:border-r lg:border-white/[0.07]">
                <span className="font-mono text-[11px] font-medium text-[#6f7874]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <button
                  aria-label={`Remove stage ${index + 1}`}
                  className="flex size-8 items-center justify-center rounded-lg text-[#9a6666] transition hover:bg-red-400/[0.08] hover:text-red-300 lg:hidden"
                  onClick={() => onRemove(index)}
                  title="Remove stage"
                  type="button"
                >
                  <X aria-hidden className="size-4" strokeWidth={1.8} />
                </button>
              </div>

              {columns.map((column) =>
                column.type === "checkbox" ? (
                  <label
                    className="col-span-1 flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border border-white/[0.08] px-3 text-[11px] text-[#aeb5b2] lg:col-span-1 lg:h-full lg:min-h-16 lg:justify-center lg:rounded-none lg:border-0 lg:border-r lg:border-white/[0.07] lg:px-0"
                    key={column.key}
                  >
                    <input
                      aria-label={column.label}
                      className="size-4 accent-[#35ae86]"
                      checked={Boolean(item[column.key])}
                      onChange={(event) =>
                        onChange(index, column.key, event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span className="lg:sr-only">{column.label}</span>
                  </label>
                ) : (
                  <label
                    className="col-span-2 flex min-w-0 flex-col gap-1.5 lg:col-span-1 lg:h-full lg:min-h-16 lg:justify-center lg:gap-0 lg:border-r lg:border-white/[0.07] lg:px-3"
                    key={column.key}
                  >
                    <span className="text-[10px] font-medium text-[#858d8a] lg:sr-only">
                      {column.label}
                    </span>
                    <span className="relative block">
                      {column.key === "color" && (
                        <span
                          aria-hidden
                          className="absolute top-1/2 left-3 size-3 -translate-y-1/2 rounded-full border border-white/20"
                          style={{
                            backgroundColor: String(
                              item[column.key] ?? "#87908b",
                            ),
                          }}
                        />
                      )}
                      <input
                        aria-label={column.label}
                        className={`h-10 w-full min-w-0 rounded-lg border border-white/[0.09] bg-black/20 px-3 text-xs text-[#e8ebe9] outline-none transition placeholder:text-white/25 focus:border-[#4ea98b] focus:ring-2 focus:ring-[#4ea98b]/15 ${column.key === "color" ? "pl-9 font-mono" : ""}`}
                        max={column.key === "probability" ? 100 : undefined}
                        min={column.key === "probability" ? 0 : undefined}
                        onChange={(event) =>
                          onChange(index, column.key, event.target.value)
                        }
                        type={
                          column.key === "probability" ? "number" : "text"
                        }
                        value={String(item[column.key] ?? "")}
                      />
                    </span>
                  </label>
                ),
              )}

              <button
                aria-label={`Remove stage ${index + 1}`}
                className="hidden min-h-16 items-center justify-center text-[#8d5d5d] transition hover:bg-red-400/[0.06] hover:text-red-300 lg:flex"
                onClick={() => onRemove(index)}
                title="Remove stage"
                type="button"
              >
                <X aria-hidden className="size-4" strokeWidth={1.8} />
              </button>
            </div>
          ))}

          {!items.length && (
            <div className="px-5 py-10 text-center text-xs text-[#747d79]">
              No stages configured yet.
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 max-[560px]:items-stretch max-[560px]:flex-col">
        <button
          className={settingsUi.secondaryButton}
          onClick={onAdd}
          type="button"
        >
          <Plus aria-hidden className="mr-1.5 size-3.5" strokeWidth={1.8} />
          {addLabel}
        </button>
        <button
          className={settingsUi.primaryButton}
          disabled={busy || !items.length}
          onClick={onSave}
          type="button"
        >
          {busy ? "Saving…" : "Save stages"}
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
    <StageDefinitionEditor
      title="Lead stages"
      description="Define the stages a lead moves through before qualification."
      addLabel="Add stage"
      busy={props.busy}
      items={props.stages}
      kind="lead"
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

function OpportunityStagesPanel(props: PanelProps & { projectId: number }) {
  const change = (index: number, key: string, next: unknown) =>
    props.setOpportunityStages(
      props.opportunityStages.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, [key]: next }
          : key === "is_initial" && next
            ? { ...item, is_initial: false }
            : item,
      ),
    );
  const saveStages = () =>
    void props.save(
      `/api/projects/${props.projectId}/opportunity-stages`,
      "PUT",
      {
        stages: props.opportunityStages.map((stage) => ({
          stage_key: stage.stage_key,
          stage_name: stage.stage_name,
          probability: Number(stage.probability),
          color: stage.color,
          is_initial: Boolean(stage.is_initial),
        })),
      },
      "Opportunity stages updated",
      () => props.loadProject(props.projectId),
    );

  return (
    <StageDefinitionEditor
      title="Opportunity pipeline"
      description="These stages begin after lead qualification. Won and lost remain closing outcomes."
      addLabel="Add stage"
      busy={props.busy}
      items={props.opportunityStages}
      kind="opportunity"
      columns={[
        { key: "stage_name", label: "Stage name" },
        { key: "stage_key", label: "Key" },
        { key: "probability", label: "Probability %" },
        { key: "color", label: "Colour" },
        { key: "is_initial", label: "Initial", type: "checkbox" },
      ]}
      onAdd={() =>
        props.setOpportunityStages([
          ...props.opportunityStages,
          {
            stage_key: `stage_${props.opportunityStages.length + 1}`,
            stage_name: "New stage",
            probability: 50,
            color: "#87908b",
            is_initial: !props.opportunityStages.length,
          },
        ])
      }
      onChange={change}
      onRemove={(index) =>
        props.setOpportunityStages(
          props.opportunityStages.filter((_, itemIndex) => itemIndex !== index),
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
  const defaultForm = () =>
    props.kind === "queues"
      ? ({ strategy: "round_robin", member_user_ids: [] } as Row)
      : props.kind === "routing-rules"
        ? ({
            priority: 100,
            match_field: "all",
            action_type: "queue",
          } as Row)
        : ({
            priority: 100,
            match_field: "all",
            applies_to: "lead",
            response_minutes: 15,
            resolution_minutes: 1440,
          } as Row);
  const [form, setForm] = useState<Row>(defaultForm);
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null);

  const activeUsers = props.users.filter(
    (row) => row.is_active !== false && row.deleted_at == null,
  );
  const activeTeams = props.teams.filter((row) => row.is_active !== false);
  const activeQueues = props.queues.filter((row) => row.is_active !== false);
  const selectedMemberIds = new Set(
    Array.isArray(form.member_user_ids)
      ? form.member_user_ids.map((id) => String(id))
      : [],
  );

  const userName = (row: Row) =>
    `${String(row.first_name ?? "")} ${String(row.last_name ?? "")}`.trim() ||
    String(row.email ?? row.username ?? "Unnamed user");

  const userTeamName = (row: Row) => {
    const team = props.teams.find(
      (item) => String(item.team_id) === String(row.team_id),
    );
    return team ? value(team, "name") : "No team";
  };

  const userRoleName = (row: Row) => {
    const role = props.roles.find(
      (item) => String(item.role_id) === String(row.role_id),
    );
    return role ? value(role, "role_name") : "No role";
  };

  const conditionsFromForm = () => {
    const field = String(form.match_field ?? "all");
    if (field === "all") return {};
    return { [field]: form.match_value };
  };

  const conditionsLabel = (row: Row) => {
    const conditions = row.conditions;
    if (!conditions || typeof conditions !== "object") return "All leads";
    const entries = Object.entries(conditions as Row);
    if (!entries.length) return "All leads";
    return entries
      .map(([key, conditionValue]) => {
        const fieldLabels: Record<string, string> = {
          campaign_id: "Campaign",
          customer_type: "Customer type",
          preferred_config: "Configuration",
          preferred_location: "Location",
          source_id: "Source",
          sub_source: "Sub-source",
          temperature: "Temperature",
        };
        let displayValue = Array.isArray(conditionValue)
          ? conditionValue.join(", ")
          : conditionValue && typeof conditionValue === "object"
            ? Array.isArray((conditionValue as Row).in)
              ? ((conditionValue as Row).in as unknown[]).join(", ")
              : String((conditionValue as Row).eq ?? "Custom condition")
            : String(conditionValue ?? "");
        if (key === "source_id") {
          const source = props.sources.find(
            (item) => String(item.source_id) === displayValue,
          );
          if (source) displayValue = value(source, "source_name");
        }
        if (key === "campaign_id") {
          const campaign = props.campaigns.find(
            (item) => String(item.campaign_id) === displayValue,
          );
          if (campaign) displayValue = value(campaign, "campaign_name");
        }
        return `${fieldLabels[key] ?? key}: ${displayValue}`;
      })
      .join(" · ");
  };

  const destinationLabel = (row: Row) => {
    if (row.action_type === "queue")
      return String(row.queue_name ?? "Queue");
    if (row.action_type === "team")
      return String(row.target_team_name ?? "Team");
    return (
      `${String(row.target_user_first_name ?? "")} ${String(row.target_user_last_name ?? "")}`.trim() ||
      "Workspace member"
    );
  };

  const resetForm = () => {
    setEditingQueueId(null);
    setForm(defaultForm());
  };

  const editQueue = async (row: Row) => {
    try {
      const id = String(row.queue_id);
      const result = await props.api(`/api/queues/${id}`);
      const queue = (result.queue as Row) ?? row;
      const members = Array.isArray(queue.members)
        ? (queue.members as Row[]).map((member) => String(member.user_id))
        : [];
      setEditingQueueId(id);
      setForm({
        name: queue.queue_name,
        code: queue.queue_code,
        description: queue.description ?? "",
        strategy: queue.assignment_strategy ?? "round_robin",
        team_id: queue.team_id ?? "",
        member_user_ids: members,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load queue",
      );
    }
  };

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
    if (props.kind === "queues") {
      if (!selectedMemberIds.size) {
        toast.error("Select at least one member for this queue");
        return;
      }
      payload = {
        project_id: props.projectId,
        queue_code:
          form.code || generateCodeFromName(String(form.name ?? "")),
        queue_name: form.name,
        description: form.description || null,
        assignment_strategy: form.strategy || "round_robin",
        team_id: form.team_id || null,
        member_user_ids: [...selectedMemberIds],
      };
    } else if (props.kind === "routing-rules") {
      payload = {
        project_id: props.projectId,
        rule_name: form.name,
        description: form.description || null,
        priority: Number(form.priority || 100),
        conditions: conditionsFromForm(),
        action_type: form.action_type || "queue",
        target_queue_id:
          form.action_type === "queue" || !form.action_type
            ? form.target_id
            : null,
        target_user_id: form.action_type === "user" ? form.target_id : null,
        target_team_id: form.action_type === "team" ? form.target_id : null,
        is_active: true,
      };
    } else {
      payload = {
        project_id: props.projectId,
        rule_name: form.name,
        description: form.description || null,
        applies_to: form.applies_to || "assignment",
        priority: Number(form.priority || 100),
        conditions: conditionsFromForm(),
        response_minutes: form.response_minutes
          ? Number(form.response_minutes)
          : null,
        resolution_minutes: form.resolution_minutes
          ? Number(form.resolution_minutes)
          : null,
        escalation_minutes: form.escalation_minutes
          ? Number(form.escalation_minutes)
          : null,
        is_active: true,
      };
    }
    const result = await props.save(
      editingQueueId
        ? `/api/queues/${editingQueueId}`
        : `/api/${props.kind}`,
      editingQueueId ? "PATCH" : "POST",
      payload,
      editingQueueId ? "Queue updated" : "Configuration created",
      () => props.loadProject(props.projectId),
    );
    if (result) resetForm();
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
          {
            key: "assignment_strategy",
            label: "Distribution",
            render: (row: Row) =>
              row.assignment_strategy === "round_robin"
                ? "Take turns"
                : row.assignment_strategy === "load_balanced"
                  ? "Balance workload"
                  : "Manual claim",
          },
          { key: "member_count", label: "Members" },
          { key: "waiting_count", label: "Waiting" },
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
            render: (row: Row) =>
              props.admin ? (
                <span className="flex items-center gap-3">
                  <button
                    className={settingsUi.tableAction}
                    disabled={props.busy}
                    onClick={() => void editQueue(row)}
                    type="button"
                  >
                    Manage
                  </button>
                  <button
                    className={settingsUi.tableAction}
                    disabled={props.busy}
                    onClick={() => toggleActive(row)}
                    type="button"
                  >
                    {row.is_active ? "Deactivate" : "Activate"}
                  </button>
                </span>
              ) : null,
          },
        ]
      : props.kind === "routing-rules"
        ? [
            { key: "rule_name", label: "Rule" },
            {
              key: "priority",
              label: "Order",
              render: (row: Row) =>
                Number(row.priority) <= 10
                  ? "First"
                  : Number(row.priority) >= 1000
                    ? "Last"
                    : "Normal",
            },
            {
              key: "conditions",
              label: "When",
              render: (row: Row) => conditionsLabel(row),
            },
            {
              key: "target",
              label: "Send to",
              render: (row: Row) => destinationLabel(row),
            },
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
            {
              key: "conditions",
              label: "For",
              render: (row: Row) => conditionsLabel(row),
            },
            {
              key: "response_minutes",
              label: "First response",
              render: (row: Row) =>
                row.response_minutes
                  ? `${String(row.response_minutes)} min`
                  : "Not tracked",
            },
            {
              key: "resolution_minutes",
              label: "Resolution",
              render: (row: Row) =>
                row.resolution_minutes
                  ? `${String(row.resolution_minutes)} min`
                  : "Not tracked",
            },
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
      <Card
        title={title}
        description={
          props.kind === "queues"
            ? "Group workspace members and distribute incoming leads between them."
            : props.kind === "routing-rules"
              ? "Rules run from highest to lowest order. The first matching rule decides where a new lead goes."
              : "SLA rules set deadlines; they do not assign leads."
        }
      >
        <ListTable rows={props.rows} columns={columns} />
      </Card>
      {props.admin && (
        <Card
          title={
            editingQueueId
              ? "Manage queue"
              : `Create ${props.kind === "queues" ? "queue" : "rule"}`
          }
          description={
            props.kind === "queues"
              ? "Choose exactly who can receive leads from this queue."
              : props.kind === "routing-rules"
                ? "Choose a simple condition and a destination—no JSON required."
                : "Choose who the target applies to and the expected response times."
          }
        >
          <form className={settingsUi.form} onSubmit={create}>
            <div className={settingsUi.grid}>
              <Field
                label={
                  props.kind === "queues"
                    ? "Queue name"
                    : props.kind === "routing-rules"
                      ? "Rule name"
                      : "SLA name"
                }
              >
                <input
                  placeholder={
                    props.kind === "queues"
                      ? "Nykaa Homes queue"
                      : props.kind === "routing-rules"
                        ? "Send all leads to a queue"
                        : "15 minute first response"
                  }
                  required
                  value={String(form.name ?? "")}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              {props.kind === "queues" ? (
                <>
                  <Field label="Code">
                    <input
                      readOnly
                      required
                      value={String(
                        form.code ||
                          generateCodeFromName(String(form.name ?? "")),
                      )}
                    />
                  </Field>
                  <Field label="Team (optional)">
                    <select
                      value={String(form.team_id ?? "")}
                      onChange={(e) => {
                        const teamId = e.target.value;
                        const teamMemberIds = teamId
                          ? activeUsers
                              .filter(
                                (member) =>
                                  String(member.team_id ?? "") === teamId,
                              )
                              .map((member) => String(member.user_id))
                          : [];
                        setForm({
                          ...form,
                          team_id: teamId,
                          member_user_ids: teamMemberIds,
                        });
                      }}
                    >
                      <option value="">No team</option>
                      {activeTeams.map((row) => (
                        <option
                          key={String(row.team_id)}
                          value={String(row.team_id)}
                        >
                          {value(row, "name")}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Distribution method">
                    <select
                      value={String(form.strategy ?? "round_robin")}
                      onChange={(event) =>
                        setForm({ ...form, strategy: event.target.value })
                      }
                    >
                      <option value="round_robin">Take turns</option>
                      <option value="load_balanced">Balance workload</option>
                      <option value="manual">Manual claim</option>
                    </select>
                  </Field>
                  <div className="col-span-2 max-[720px]:col-span-1">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-[11px] font-medium tracking-wide text-[#8e9693]">
                        Queue members
                      </span>
                      <span className="text-[10px] text-[#68706d]">
                        {selectedMemberIds.size} selected
                      </span>
                    </div>
                    <div className="max-h-64 overflow-auto rounded-lg border border-white/[0.08] bg-black/10 [scrollbar-width:thin]">
                      {activeUsers.length ? (
                        <table className="w-full min-w-[580px] border-collapse text-left">
                          <thead className="sticky top-0 bg-[#101312] text-[9px] font-semibold uppercase tracking-[0.1em] text-[#68706d]">
                            <tr className="border-b border-white/[0.08]">
                              <th className="w-12 px-4 py-3">
                                <span className="sr-only">Selected</span>
                              </th>
                              <th className="px-2 py-3">Member</th>
                              <th className="px-3 py-3">Team</th>
                              <th className="px-3 py-3">Role</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeUsers.map((member) => {
                              const id = String(member.user_id);
                              const checked = selectedMemberIds.has(id);
                              return (
                                <tr
                                  className="border-b border-white/[0.07] last:border-b-0 hover:bg-white/[0.018]"
                                  key={id}
                                >
                                  <td className="px-4 py-3">
                                    <input
                                      aria-label={`Select ${userName(member)}`}
                                      checked={checked}
                                      className="size-3.5 accent-[#42b995]"
                                      onChange={() => {
                                        const next = new Set(selectedMemberIds);
                                        if (checked) next.delete(id);
                                        else next.add(id);
                                        setForm({
                                          ...form,
                                          member_user_ids: [...next],
                                        });
                                      }}
                                      type="checkbox"
                                    />
                                  </td>
                                  <td className="px-2 py-3">
                                    <strong className="block truncate text-[11px] font-medium text-[#e2e5e3]">
                                      {userName(member)}
                                    </strong>
                                    <small className="mt-0.5 block truncate text-[9px] text-[#6f7774]">
                                      {String(member.email ?? "")}
                                    </small>
                                  </td>
                                  <td className="px-3 py-3 text-[10px] text-[#aeb4b1]">
                                    {userTeamName(member)}
                                  </td>
                                  <td className="px-3 py-3 text-[10px] text-[#aeb4b1]">
                                    {userRoleName(member)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      ) : (
                        <div className="px-4 py-8 text-center text-[10px] text-[#777f7c]">
                          Add an active workspace member under People &amp; access first.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <Field label="Which leads should this apply to?">
                    <select
                      value={String(form.match_field ?? "all")}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          match_field: e.target.value,
                          match_value: "",
                        })
                      }
                    >
                      <option value="all">All new leads</option>
                      <option value="temperature">Lead temperature</option>
                      <option value="source_id">Lead source</option>
                      <option value="campaign_id">Campaign</option>
                      <option value="sub_source">Sub-source</option>
                      <option value="preferred_location">
                        Preferred location
                      </option>
                      <option value="preferred_config">
                        Preferred configuration
                      </option>
                      <option value="customer_type">Customer type</option>
                    </select>
                  </Field>
                  {String(form.match_field ?? "all") !== "all" ? (
                    <Field label="Value to match">
                      {form.match_field === "temperature" ? (
                        <select
                          required
                          value={String(form.match_value ?? "")}
                          onChange={(e) =>
                            setForm({ ...form, match_value: e.target.value })
                          }
                        >
                          <option value="">Choose temperature</option>
                          <option value="hot">Hot</option>
                          <option value="warm">Warm</option>
                          <option value="cold">Cold</option>
                        </select>
                      ) : form.match_field === "source_id" ? (
                        <select
                          required
                          value={String(form.match_value ?? "")}
                          onChange={(e) =>
                            setForm({ ...form, match_value: e.target.value })
                          }
                        >
                          <option value="">Choose source</option>
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
                      ) : form.match_field === "campaign_id" ? (
                        <select
                          required
                          value={String(form.match_value ?? "")}
                          onChange={(e) =>
                            setForm({ ...form, match_value: e.target.value })
                          }
                        >
                          <option value="">Choose campaign</option>
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
                      ) : (
                        <input
                          placeholder="Enter the exact value"
                          required
                          value={String(form.match_value ?? "")}
                          onChange={(e) =>
                            setForm({ ...form, match_value: e.target.value })
                          }
                        />
                      )}
                    </Field>
                  ) : (
                    <div className="flex items-end pb-3 text-[10px] leading-relaxed text-[#737b78]">
                      This is a fallback that matches every new lead.
                    </div>
                  )}
                  {props.kind === "routing-rules" && (
                    <Field label="Rule order">
                      <select
                        value={String(form.priority ?? 100)}
                        onChange={(e) =>
                          setForm({ ...form, priority: Number(e.target.value) })
                        }
                      >
                        <option value="10">First — special rule</option>
                        <option value="100">Normal</option>
                        <option value="1000">Last — fallback rule</option>
                      </select>
                    </Field>
                  )}
                  {props.kind === "routing-rules" ? (
                    <>
                      <Field label="Send the lead to">
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
                          <option value="queue">A queue</option>
                          <option value="user">One workspace member</option>
                          <option value="team">A team</option>
                        </select>
                      </Field>
                      <Field label="Choose destination">
                        <select
                          required
                          value={String(form.target_id ?? "")}
                          onChange={(e) =>
                            setForm({ ...form, target_id: e.target.value })
                          }
                        >
                          <option value="">Select destination</option>
                          {(form.action_type === "user"
                            ? activeUsers
                            : form.action_type === "team"
                              ? activeTeams
                              : activeQueues
                          ).map((row) => (
                            <option
                              key={String(
                                form.action_type === "user"
                                  ? row.user_id
                                  : form.action_type === "team"
                                    ? row.team_id
                                    : row.queue_id,
                              )}
                              value={String(
                                form.action_type === "user"
                                  ? row.user_id
                                  : form.action_type === "team"
                                    ? row.team_id
                                    : row.queue_id,
                              )}
                            >
                              {form.action_type === "user"
                                ? userName(row)
                                : value(
                                    row,
                                    form.action_type === "team"
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
                      <Field label="Start measuring from">
                        <select
                          value={String(form.applies_to ?? "lead")}
                          onChange={(e) =>
                            setForm({ ...form, applies_to: e.target.value })
                          }
                        >
                          <option value="lead">When the lead is created</option>
                          <option value="assignment">
                            When the lead is assigned
                          </option>
                        </select>
                      </Field>
                      <Field label="First response due in">
                        <select
                          value={String(form.response_minutes ?? 15)}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              response_minutes: Number(e.target.value),
                            })
                          }
                        >
                          <option value="5">5 minutes</option>
                          <option value="10">10 minutes</option>
                          <option value="15">15 minutes</option>
                          <option value="30">30 minutes</option>
                          <option value="60">1 hour</option>
                          <option value="120">2 hours</option>
                        </select>
                      </Field>
                      <Field label="Resolution due in">
                        <select
                          value={String(form.resolution_minutes ?? 1440)}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              resolution_minutes: Number(e.target.value),
                            })
                          }
                        >
                          <option value="120">2 hours</option>
                          <option value="480">8 hours</option>
                          <option value="1440">24 hours</option>
                          <option value="2880">2 days</option>
                          <option value="10080">7 days</option>
                        </select>
                      </Field>
                    </>
                  )}
                </>
              )}
            </div>
            <div className={settingsUi.actions}>
              {editingQueueId && (
                <button
                  className={settingsUi.secondaryButton}
                  onClick={resetForm}
                  type="button"
                >
                  Cancel
                </button>
              )}
              <SaveButton busy={props.busy}>
                {editingQueueId
                  ? "Save queue"
                  : props.kind === "queues"
                    ? "Create queue"
                    : "Create and activate"}
              </SaveButton>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
