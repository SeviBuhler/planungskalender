// "Remember me" rules: after password + a second factor (mail code or Face ID / passkey)
// the login is trusted for a week, then the user has to log in again.

export const TRUST_DAYS = 7;
// How long after the password the second step may still be completed
export const SECOND_STEP_MINUTES = 15;

// Methods that count as the second step. The mail code replaces the password session, so it shows up as 'otp'.
// The device unlock is not part of the token, see deviceUnlockValid.
const SECOND_FACTORS = ['otp', 'mfa/webauthn', 'mfa/totp'];

export interface AuthMethod {
  method: string;
  // seconds since epoch
  timestamp: number;
}

export type TrustState = 'trusted' | 'second-factor' | 'none';

// amr comes from the session JWT; entries without a timestamp (plain strings) are ignored
export function trustState(amr: readonly (AuthMethod | string)[], nowMs: number): TrustState {
  const nowSeconds = nowMs / 1000;
  const latest = (methods: string[]) =>
    Math.max(-Infinity, ...amr.filter((m): m is AuthMethod => typeof m !== 'string' && methods.includes(m.method)).map((m) => m.timestamp));

  if (nowSeconds - latest(SECOND_FACTORS) < TRUST_DAYS * 86400) return 'trusted';
  if (nowSeconds - latest(['password']) < SECOND_STEP_MINUTES * 60) return 'second-factor';
  return 'none';
}

// The device unlock is stored per login session (table device_unlocks) and also counts for a week
export function deviceUnlockValid(verifiedAt: string | null, nowMs: number): boolean {
  return verifiedAt !== null && nowMs - Date.parse(verifiedAt) < TRUST_DAYS * 86400 * 1000;
}
