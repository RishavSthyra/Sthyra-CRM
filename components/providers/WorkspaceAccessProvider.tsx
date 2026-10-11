"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getCachedWorkspaceContext,
  getWorkspaceContext,
  isWorkspacePathname,
  WORKSPACE_CONTEXT_UPDATED_EVENT,
  WORKSPACE_SESSION_REFRESHED_EVENT,
  WorkspaceContextRequestError,
  type WorkspaceAccessContext,
} from "@/lib/clientWorkspaceContext";

type WorkspaceAccessState = {
  access: WorkspaceAccessContext | null;
  status: "idle" | "loading" | "ready" | "error";
  ensureLoaded: () => Promise<void>;
  refresh: () => Promise<void>;
};

const WorkspaceAccessContextValue = createContext<WorkspaceAccessState | null>(
  null,
);

export function WorkspaceAccessProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [access, setAccess] = useState<WorkspaceAccessContext | null>(() =>
    getCachedWorkspaceContext(),
  );
  const accessRef = useRef(access);
  const [status, setStatus] = useState<WorkspaceAccessState["status"]>(
    access ? "ready" : "idle",
  );

  useEffect(() => {
    accessRef.current = access;
  }, [access]);

  const load = useCallback(
    async (force: boolean) => {
      if (!accessRef.current) setStatus("loading");
      try {
        const nextAccess = await getWorkspaceContext({ force });
        accessRef.current = nextAccess;
        setAccess(nextAccess);
        setStatus("ready");
      } catch (error) {
        if (
          error instanceof WorkspaceContextRequestError &&
          error.status === 401
        ) {
          window.location.replace("/login");
          return;
        }
        if (!accessRef.current) setStatus("error");
      }
    },
    [],
  );

  const ensureLoaded = useCallback(() => load(false), [load]);
  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    if (!isWorkspacePathname(window.location.pathname)) return;
    const task = window.setTimeout(() => void load(false), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  useEffect(() => {
    const updateFromCache = (event: Event) => {
      const nextAccess = (event as CustomEvent<WorkspaceAccessContext | null>)
        .detail;
      accessRef.current = nextAccess;
      setAccess(nextAccess);
      setStatus(nextAccess ? "ready" : "loading");
    };
    window.addEventListener(WORKSPACE_CONTEXT_UPDATED_EVENT, updateFromCache);
    return () => {
      window.removeEventListener(
        WORKSPACE_CONTEXT_UPDATED_EVENT,
        updateFromCache,
      );
    };
  }, []);

  useEffect(() => {
    if (!access) return;
    const refreshOnFocus = () => void load(true);
    const refreshAfterSession = () => void load(true);
    const interval = window.setInterval(() => void load(true), 5 * 60_000);

    window.addEventListener("focus", refreshOnFocus);
    window.addEventListener(
      WORKSPACE_SESSION_REFRESHED_EVENT,
      refreshAfterSession,
    );
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
      window.removeEventListener(
        WORKSPACE_SESSION_REFRESHED_EVENT,
        refreshAfterSession,
      );
    };
  }, [access, load]);

  return (
    <WorkspaceAccessContextValue.Provider
      value={{ access, status, ensureLoaded, refresh }}
    >
      {children}
    </WorkspaceAccessContextValue.Provider>
  );
}

export function useWorkspaceAccess() {
  const value = useContext(WorkspaceAccessContextValue);
  if (!value) {
    throw new Error(
      "useWorkspaceAccess must be used inside WorkspaceAccessProvider",
    );
  }
  return value;
}
