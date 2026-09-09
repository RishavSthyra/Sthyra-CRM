export function validateText(
  value: unknown,
  field: string,
  maxLength: number,
  nullable: boolean,
  errors: string[],
): string | null | undefined {

  // checking if the value is undefined
  if (value === undefined) return undefined;

 // checking if the value is null
  if (value === null) {
    if (nullable) return null; // allow to be null only if its nullable
    errors.push(`${field} cannot be null`);
    return undefined;
  }


  //check the type of the value

  if (typeof value !== "string") {
    errors.push(`${field} must be a string`);
    return undefined;
  }

  // normalise by removing the spaces

  const normalized = value.trim();

  // if someone put spaces only
  
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