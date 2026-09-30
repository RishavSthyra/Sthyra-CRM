export function invitationAccountConflictMessage(
  existingCompanyId: number,
  invitationCompanyId: number,
): string {
  if (existingCompanyId === invitationCompanyId) {
    return "This account is already a member of this company. Sign in instead.";
  }

  return "This account already belongs to another company and cannot join a second company yet.";
}
