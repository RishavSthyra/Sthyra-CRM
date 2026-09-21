import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

type PaginationResult =
  | { ok: true; page: number; limit: number; offset: number }
  | { ok: false; error: string };

export function parsePagination(
  parameters: URLSearchParams,
  defaultLimit = 20,
  maximumLimit = 100,
): PaginationResult {
  const page = parsePositiveInteger(parameters.get("page"), 1);
  const limit = parsePositiveInteger(parameters.get("limit"), defaultLimit);
  if (page === null || limit === null || limit > maximumLimit) {
    return {
      ok: false,
      error: `page and limit must be positive integers; limit cannot exceed ${maximumLimit}`,
    };
  }
  return { ok: true, page, limit, offset: (page - 1) * limit };
}
