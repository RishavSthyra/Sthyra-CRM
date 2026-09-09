export function validatePositiveNumber(
  value: unknown,
  field: string,
  errors: string[],
  
): number | null | undefined {


  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push(`${field} must be a finite number greater than zero or null`);
    return undefined;
  }

  return value;
}