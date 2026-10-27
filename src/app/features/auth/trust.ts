// Login rules: a login stays until the user logs out. A second step is only needed
// when the user switched it on in the options (mail code or authenticator app).
// A passkey login counts as complete on its own.

// Second step the user chose in the options
export type SecondFactor = 'none' | 'mail' | 'totp';

export type TrustState = 'trusted' | 'mail-code' | 'totp' | 'none';

export interface AuthMethod {
  method: string;
  // seconds since epoch
  timestamp: number;
}

// Methods that only prove the password or the mailbox
const PASSWORD = 'password';
const MAIL = ['otp', 'magiclink', 'email/signup'];

// amr comes from the session JWT (objects with timestamps or plain strings)
export function trustState(amr: readonly (AuthMethod | string)[] | null, required: SecondFactor): TrustState {
  if (!amr) return 'none';
  const methods = amr.map((m) => (typeof m === 'string' ? m : m.method));
  // Passkey, authenticator app (and anything else that is not password or mail)
  const strong = methods.some((m) => m !== PASSWORD && !MAIL.includes(m));
  if (required === 'totp') return strong ? 'trusted' : 'totp';
  if (required === 'mail') return methods.some((m) => m !== PASSWORD) ? 'trusted' : 'mail-code';
  return 'trusted';
}
