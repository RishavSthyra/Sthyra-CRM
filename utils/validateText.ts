export function validateText(
  value: unknown,
  field: string,
  maxLength: number,
  nullable: boolean,
  errors: string[],
): string | null | undefined {
  if (value === undefined) return undefined;

  if (value === null) {
    if (nullable) return null;
    errors.push(`${field} cannot be null`);
    return undefined;
  }

  if (typeof value !== "string") {
    errors.push(`${field} must be a string`);
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    if (nullable) return null;
    errors.push(`${field} cannot be empty`);
    return undefined;
  }

  if (normalized.length > maxLength) {
    errors.push(`${field} must be at most ${maxLength} characters`);
    return undefined;
  }

  return normalized;
}