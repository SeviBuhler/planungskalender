import {
  decryptText,
  encryptText,
  exportModuleKey,
  exportPublicKey,
  generateRecoveryCode,
  generateUserKeys,
  importPublicKey,
  isEncrypted,
  moduleKey,
  newScopeKey,
  normalizeRecoveryCode,
  openScopeKey,
  scopeOf,
  sealScopeKey,
  unwrapPrivateKey,
  wrapPrivateKey,
} from './e2ee';

const SCOPE = '11111111-2222-4333-8444-555555555555';

describe('recovery code', () => {
  it('has six groups of four readable characters', () => {
    expect(generateRecoveryCode()).toMatch(/^([A-HJ-NP-Z2-9]{4}-){5}[A-HJ-NP-Z2-9]{4}$/);
  });

  it('accepts typed variants of a code', () => {
    const code = generateRecoveryCode();
    expect(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code);
    expect(normalizeRecoveryCode('ABCD')).toBeNull();
  });
});

describe('keys', () => {
  it('opens the private key only with the right code', async () => {
    const keys = await generateUserKeys();
    const code = generateRecoveryCode();
    const wrapped = await wrapPrivateKey(keys.privateKey, code);
    const restored = await unwrapPrivateKey(wrapped, code);

    const scopeKey = newScopeKey();
    const sealed = await sealScopeKey(scopeKey, await importPublicKey(await exportPublicKey(keys.publicKey)));
    expect(await openScopeKey(sealed, restored)).toEqual(scopeKey);

    await expect(unwrapPrivateKey(wrapped, generateRecoveryCode())).rejects.toBeDefined();
  });

  it('seals a scope key so only the recipient opens it', async () => {
    const alice = await generateUserKeys();
    const bob = await generateUserKeys();
    const sealed = await sealScopeKey(newScopeKey(), alice.publicKey);
    await expect(openScopeKey(sealed, bob.privateKey)).rejects.toBeDefined();
  });
});

describe('text', () => {
  it('round-trips and names the scope', async () => {
    const key = await moduleKey(newScopeKey(), 'calendar');
    const value = await encryptText(key, SCOPE, 'Zahnarzt 🦷');
    expect(isEncrypted(value)).toBe(true);
    expect(scopeOf(value)).toBe(SCOPE);
    expect(value).not.toContain('Zahnarzt');
    expect(await decryptText(key, value)).toBe('Zahnarzt 🦷');
    expect(isEncrypted('Zahnarzt')).toBe(false);
  });

  it('uses a different key per module', async () => {
    const scopeKey = newScopeKey();
    const value = await encryptText(await moduleKey(scopeKey, 'calendar'), SCOPE, 'x');
    await expect(decryptText(await moduleKey(scopeKey, 'finance'), value)).rejects.toBeDefined();
  });

  it('rejects text moved to another scope', async () => {
    const key = await moduleKey(newScopeKey(), 'calendar');
    const value = await encryptText(key, SCOPE, 'x');
    await expect(decryptText(key, value.replace(SCOPE, '99999999-2222-4333-8444-555555555555'))).rejects.toBeDefined();
  });

  it('exports the module key the server uses for the feed', async () => {
    const key = await moduleKey(newScopeKey(), 'calendar', true);
    expect(await exportModuleKey(key)).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });
});
