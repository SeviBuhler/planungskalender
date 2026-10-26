import { trustState } from './trust';

const NOW = Date.UTC(2026, 9, 26, 12);
const ago = (seconds: number) => NOW / 1000 - seconds;
const DAY = 86400;

describe('trustState', () => {
  it('trusts a login with a mail code for a week', () => {
    expect(trustState([{ method: 'otp', timestamp: ago(6 * DAY) }], NOW)).toBe('trusted');
    expect(trustState([{ method: 'otp', timestamp: ago(7 * DAY + 1) }], NOW)).toBe('none');
  });

  it('trusts password + Face ID for a week', () => {
    const amr = [
      { method: 'password', timestamp: ago(3 * DAY) },
      { method: 'mfa/webauthn', timestamp: ago(3 * DAY) },
    ];
    expect(trustState(amr, NOW)).toBe('trusted');
  });

  it('asks for the second step right after the password', () => {
    expect(trustState([{ method: 'password', timestamp: ago(60) }], NOW)).toBe('second-factor');
  });

  it('starts over when the password is old and no second step happened', () => {
    expect(trustState([{ method: 'password', timestamp: ago(20 * 60) }], NOW)).toBe('none');
    expect(trustState([], NOW)).toBe('none');
    expect(trustState(['password', 'otp'], NOW)).toBe('none');
  });
});
