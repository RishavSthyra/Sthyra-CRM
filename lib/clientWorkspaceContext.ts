import { fetchWithSession, getApiError } from "@/lib/clientAuth";

export type WorkspaceProjectContext = {
  project_id: number;
  project_code: string;
  project_name: string;
  project_status?: string;
  project_type?: string;
  [key: string]: unknown;
};

export type WorkspaceAccessContext = {
  user_id?: string;
  company: {
    company_id: number;
    company_name: string;
    [key: string]: unknown;
  };
  team: Record<string, unknown> | null;
  role_key: string;
  can_view_all_projects: boolean;
  permissions: string[];
  projects: WorkspaceProjectContext[];
};

export const WORKSPACE_CONTEXT_UPDATED_EVENT = "workspace-context:updated";
export const WORKSPACE_SESSION_REFRESHED_EVENT = "workspace-session:refreshed";

export class WorkspaceContextRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WorkspaceContextRequestError";
  }
}

let cachedContext: WorkspaceAccessContext | null = null;
let pendingRequest: Promise<WorkspaceAccessContext> | null = null;

function publish(context: WorkspaceAccessContext | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_CONTEXT_UPDATED_EVENT, { detail: context }),
  );
}

export function getCachedWorkspaceContext() {
  return cachedContext;
}

export function clearWorkspaceContextCache() {
  cachedContext = null;
  pendingRequest = null;
  publish(null);
}

export async function getWorkspaceContext<T = WorkspaceAccessContext>({
  force = false,
}: { force?: boolean } = {}): Promise<T> {
  if (!force && cachedContext) return cachedContext as T;
  if (pendingRequest) return pendingRequest as Promise<T>;

  pendingRequest = (async () => {
    const response = await fetchWithSession("/api/auth/project-context", {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new WorkspaceContextRequestError(
        await getApiError(response),
        response.status,
      );
    }

    const context = (await response.json()) as WorkspaceAccessContext;
    cachedContext = {
      ...context,
      user_id: String(context.user_id ?? ""),
      role_key: String(context.role_key ?? ""),
      can_view_all_projects: Boolean(context.can_view_all_projects),
      permissions: Array.isArray(context.permissions)
        ? context.permissions.map(String)
        : [],
      projects: Array.isArray(context.projects) ? context.projects : [],
    };
    publish(cachedContext);
    return cachedContext;
  })().finally(() => {
    pendingRequest = null;
  });

  return pendingRequest as Promise<T>;
}

const WORKSPACE_ROUTES = [
  "/activity",
  "/calendar",
  "/dashboard",
  "/inventory",
  "/leads",
  "/marketing",
  "/notifications",
  "/opportunities",
  "/preferences",
  "/settings",
  "/team-members",
  "/transfers",
] as const;

export function isWorkspacePathname(pathname: string) {
  return WORKSPACE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}
