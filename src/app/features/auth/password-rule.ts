// Rule for new passwords (sign-up and password change). Existing passwords stay valid,
// because Supabase only checks a password when it is set.
export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_RULE_TEXT =
  'Mindestens 8 Zeichen, Gross- und Kleinbuchstaben, 1 Zahl und 2 Sonderzeichen.';

// What is still missing; an empty list means the password is fine
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if ([...password].length < MIN_PASSWORD_LENGTH) problems.push(`mindestens ${MIN_PASSWORD_LENGTH} Zeichen`);
  if (!/\p{Lu}/u.test(password)) problems.push('ein Grossbuchstabe');
  if (!/\p{Ll}/u.test(password)) problems.push('ein Kleinbuchstabe');
  if (!/\p{N}/u.test(password)) problems.push('eine Zahl');
  if ((password.match(/[^\p{L}\p{N}\s]/gu) ?? []).length < 2) problems.push('zwei Sonderzeichen');
  return problems;
}

export function passwordRuleError(password: string): string | null {
  const problems = passwordProblems(password);
  return problems.length ? `Dem Passwort fehlt noch: ${problems.join(', ')}.` : null;
}
