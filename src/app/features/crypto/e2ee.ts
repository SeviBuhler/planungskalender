// End-to-end encryption building blocks (Web Crypto only, no server involved).
//
// - Every user has an ECDH P-256 key pair. The private key leaves the device only wrapped with
//   the recovery code (PBKDF2 → AES-GCM), so the server never sees it in plain form.
// - Every scope (one per household, one personal per user) has a random 32-byte key. It is stored
//   once per member, sealed to that member's public key (ephemeral ECDH → HKDF → AES-GCM).
// - Each module (calendar, later finance and shopping) derives its own AES key from the scope key,
//   so sharing the calendar key with the subscription feed reveals nothing else.
// - Encrypted text looks like `e1:<scope id>:<base64(iv | ciphertext)>`; the scope id tells which
//   key opens it, even after an event moved from a household to private.

export type CryptoModule = 'calendar' | 'finance' | 'shopping';

const PREFIX = 'e1:';
const PBKDF2_ITERATIONS = 310_000;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I that look alike
const RECOVERY_GROUPS = 6;
const RECOVERY_GROUP_LENGTH = 4;

const ECDH: EcKeyImportParams = { name: 'ECDH', namedCurve: 'P-256' };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---- Base64 ----

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

// ---- Recovery code ----

// 24 characters of 32 symbols = 120 bits, shown as XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
export function generateRecoveryCode(): string {
  const chars = Array.from(randomBytes(RECOVERY_GROUPS * RECOVERY_GROUP_LENGTH), (b) => RECOVERY_ALPHABET[b % 32]);
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += RECOVERY_GROUP_LENGTH) groups.push(chars.slice(i, i + RECOVERY_GROUP_LENGTH).join(''));
  return groups.join('-');
}

// Accepts lower case, spaces and missing dashes; null when it cannot be a code
export function normalizeRecoveryCode(input: string): string | null {
  const chars = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (chars.length !== RECOVERY_GROUPS * RECOVERY_GROUP_LENGTH) return null;
  if ([...chars].some((c) => !RECOVERY_ALPHABET.includes(c))) return null;
  return chars.match(new RegExp(`.{${RECOVERY_GROUP_LENGTH}}`, 'g'))!.join('-');
}

async function codeKey(code: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ---- User key pair ----

export async function generateUserKeys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', key)));
}

export async function importPublicKey(text: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', fromBase64(text), ECDH, true, []);
}

// The private key as stored on the server: only the recovery code opens it
export async function wrapPrivateKey(privateKey: CryptoKey, code: string): Promise<string> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await codeKey(code, salt), pkcs8));
  return JSON.stringify({ v: 1, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(data) });
}

// Throws when the code is wrong
export async function unwrapPrivateKey(wrapped: string, code: string): Promise<CryptoKey> {
  const { salt, iv, data } = JSON.parse(wrapped) as { salt: string; iv: string; data: string };
  const pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await codeKey(code, fromBase64(salt)), fromBase64(data));
  // Extractable so a new recovery code can wrap it again later
  return crypto.subtle.importKey('pkcs8', pkcs8, ECDH, true, ['deriveBits']);
}

// ---- Scope keys, sealed to a member ----

export function newScopeKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(32);
}

async function sealingKey(privateKey: CryptoKey, publicKey: CryptoKey, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('fortwo:scope-key') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function sealScopeKey(scopeKey: Uint8Array<ArrayBuffer>, recipient: CryptoKey): Promise<string> {
  const ephemeral = await generateUserKeys();
  const epk = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const iv = randomBytes(12);
  const key = await sealingKey(ephemeral.privateKey, recipient, epk);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, scopeKey));
  return JSON.stringify({ v: 1, epk: toBase64(epk), iv: toBase64(iv), data: toBase64(data) });
}

export async function openScopeKey(sealed: string, privateKey: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const { epk, iv, data } = JSON.parse(sealed) as { epk: string; iv: string; data: string };
  const epkBytes = fromBase64(epk);
  const ephemeral = await crypto.subtle.importKey('raw', epkBytes, ECDH, false, []);
  const key = await sealingKey(privateKey, ephemeral, epkBytes);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(data)));
}

// ---- Module keys and text ----

export async function moduleKey(scopeKey: Uint8Array<ArrayBuffer>, module: CryptoModule, extractable = false): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', scopeKey, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(`fortwo:module:${module}`) },
    base,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt']
  );
}

export async function exportModuleKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

export function isEncrypted(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

// Scope id of an encrypted text, null for plain text
export function scopeOf(value: string | null | undefined): string | null {
  if (!isEncrypted(value)) return null;
  const end = value.indexOf(':', PREFIX.length);
  return end < 0 ? null : value.slice(PREFIX.length, end);
}

export async function encryptText(key: CryptoKey, scopeId: string, text: string): Promise<string> {
  const iv = randomBytes(12);
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(scopeId) }, key, encoder.encode(text))
  );
  return `${PREFIX}${scopeId}:${toBase64(concat(iv, data))}`;
}

export async function decryptText(key: CryptoKey, value: string): Promise<string> {
  const scopeId = scopeOf(value);
  if (scopeId === null) throw new Error('Kein verschlüsselter Text');
  const bytes = fromBase64(value.slice(PREFIX.length + scopeId.length + 1));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: encoder.encode(scopeId) },
    key,
    bytes.subarray(12)
  );
  return decoder.decode(plain);
}
