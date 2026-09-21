export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function validatePassword(value: unknown, field = "password"): string[] {
  if (typeof value !== "string") {
    return [`${field} must be a string`];
  }

  if (value.length < PASSWORD_MIN_LENGTH) {
    return [`${field} must contain at least ${PASSWORD_MIN_LENGTH} characters`];
  }

  if (value.length > PASSWORD_MAX_LENGTH) {
    return [`${field} cannot exceed ${PASSWORD_MAX_LENGTH} characters`];
  }

  return [];
}
