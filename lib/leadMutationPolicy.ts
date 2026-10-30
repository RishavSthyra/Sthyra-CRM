type Queryable = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }>;
};

export const REOPEN_REQUIRED_LEAD_STATUSES = [
  "closed",
  "duplicate",
  "invalid",
] as const;

export function leadRequiresReopen(status: unknown): boolean {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  return REOPEN_REQUIRED_LEAD_STATUSES.includes(
    normalizedStatus as (typeof REOPEN_REQUIRED_LEAD_STATUSES)[number],
  );
}

export class LeadReopenRequiredError extends Error {
  readonly code = "LEAD_REOPEN_REQUIRED";
  readonly status: string;

  constructor(status: string) {
    super(`Reopen this ${status} lead before adding or changing activity`);
    this.name = "LeadReopenRequiredError";
    this.status = status;
  }
}

export async function assertLeadOpenForMutation(
  client: Queryable,
  input: {
    leadId?: string | null;
    companyId: number;
    projectId: number;
  },
): Promise<void> {
  if (!input.leadId) return;
  const result = await client.query(
    `SELECT status
     FROM leads
     WHERE lead_id=$1 AND company_id=$2 AND project_id=$3
     FOR UPDATE`,
    [input.leadId, input.companyId, input.projectId],
  );
  const status = result.rows[0]?.status;
  if (leadRequiresReopen(status)) {
    throw new LeadReopenRequiredError(String(status));
  }
}

export function isLeadReopenRequiredError(
  error: unknown,
): error is LeadReopenRequiredError {
  return error instanceof LeadReopenRequiredError;
}
