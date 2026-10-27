import { trustState } from './trust';

const at = (method: string) => ({ method, timestamp: 1_800_000_000 });

describe('trustState', () => {
  it('is logged out without a session', () => {
    expect(trustState(null, 'none')).toBe('none');
  });

  it('trusts any login when no second step is switched on', () => {
    expect(trustState([at('password')], 'none')).toBe('trusted');
    expect(trustState(['otp'], 'none')).toBe('trusted');
  });

  it('asks for the mail code after the password when chosen', () => {
    expect(trustState([at('password')], 'mail')).toBe('mail-code');
    expect(trustState([at('password'), at('otp')], 'mail')).toBe('trusted');
    expect(trustState([at('otp')], 'mail')).toBe('trusted');
  });

  it('asks for the app code even after a mail code when the app is chosen', () => {
    expect(trustState([at('password')], 'totp')).toBe('totp');
    expect(trustState([at('otp')], 'totp')).toBe('totp');
    expect(trustState([at('password'), at('totp')], 'totp')).toBe('trusted');
  });

  it('lets a passkey login through on its own', () => {
    expect(trustState([at('passkey')], 'totp')).toBe('trusted');
    expect(trustState([at('passkey')], 'mail')).toBe('trusted');
  });
});
