export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordRequirement = {
  key: "uppercase" | "lowercase" | "number" | "special" | "length";
  label: string;
  met: boolean;
};

export function getPasswordRequirements(value: string): PasswordRequirement[] {
  return [
    { key: "uppercase", label: "Uppercase letter", met: /[A-Z]/.test(value) },
    { key: "lowercase", label: "Lowercase letter", met: /[a-z]/.test(value) },
    { key: "number", label: "Number", met: /\d/.test(value) },
    {
      key: "special",
      label: "Special character (for example !@#$%)",
      met: /[^A-Za-z0-9\s]/.test(value),
    },
    {
      key: "length",
      label: `${PASSWORD_MIN_LENGTH} characters or more`,
      met: value.length >= PASSWORD_MIN_LENGTH,
    },
  ];
}

export function isPasswordValid(value: string): boolean {
  return (
    value.length <= PASSWORD_MAX_LENGTH &&
    getPasswordRequirements(value).every((requirement) => requirement.met)
  );
}

export function validatePassword(value: unknown, field = "password"): string[] {
  if (typeof value !== "string") {
    return [`${field} must be a string`];
  }

  const errors: string[] = [];
  if (value.length > PASSWORD_MAX_LENGTH) {
    errors.push(`${field} cannot exceed ${PASSWORD_MAX_LENGTH} characters`);
  }
  for (const requirement of getPasswordRequirements(value)) {
    if (requirement.met) {
      continue;
    }
    if (requirement.key === "length") {
      errors.push(
        `${field} must contain at least ${PASSWORD_MIN_LENGTH} characters`,
      );
    } else if (requirement.key === "uppercase") {
      errors.push(`${field} must contain an uppercase letter`);
    } else if (requirement.key === "lowercase") {
      errors.push(`${field} must contain a lowercase letter`);
    } else if (requirement.key === "number") {
      errors.push(`${field} must contain a number`);
    } else {
      errors.push(`${field} must contain a special character`);
    }
  }
  return errors;
}
