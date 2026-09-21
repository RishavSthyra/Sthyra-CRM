export function validatePositiveInteger(
  value: unknown,
  field: string,
  errors: string[],
  allowZero? : boolean,
  
): number | null | undefined {

  if (value === undefined) return undefined;
  if (value === null) return null;

  if (allowZero) {
  if (typeof value !== "number" || !Number.isFinite(value) ||
        !Number.isInteger(value) || value < 0) {
    errors.push(`${field} must be a finite number greater than zero or null`);
    return undefined;
  }
  }else {
    if (typeof value !== "number" || !Number.isFinite(value) ||
     !Number.isInteger(value) || value <= 0) {
    errors.push(`${field} must be a finite number greater than zero or null`);
    return undefined;
  }
  }

  return value;
}