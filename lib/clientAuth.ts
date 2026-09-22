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

  const refreshed = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
  });
  if (!refreshed.ok) {
    return response;
  }
  return fetch(input, { ...init, credentials: "include" });
}
