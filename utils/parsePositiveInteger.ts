export function parsePositiveInteger(
  value: string | null,
  fallback?: number,
): number | null {
  if (value === null) return fallback ?? null;
  if (!/^\d+$/.test(value)) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
