export function validateCoordinate(
  value: unknown,
  field: "latitude" | "longitude",
  errors: string[],
): number | null | undefined {
    
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${field} must be a finite number or null`);
    return undefined;
  }

  const limit = field === "latitude" ? 90 : 180;
  if (value < -limit || value > limit) {
    errors.push(`${field} must be between -${limit} and ${limit}`);
    return undefined;
  }

  return value;
}
