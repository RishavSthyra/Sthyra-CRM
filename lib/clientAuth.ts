export type ApiErrorBody = {
  error?: string;
  message?: string;
  details?: string[];
};

export async function getApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
  if (body.details?.length) {
    return body.details.join(". ");
  }
  return (
    body.error ?? body.message ?? "Something went wrong. Please try again."
  );
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function fetchWithSession(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
  });
  if (response.status !== 401) {
    return response;
  }

  const refreshed = await refreshSession();
  if (!refreshed) {
    return response;
  }
  return fetch(input, { ...init, credentials: "include" });
}
