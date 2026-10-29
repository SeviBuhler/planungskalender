// Push-Erinnerungen für ForTwo-Termine. Tabellen und Cron-Job:
// supabase/migrations/20261027140000_push_reminders.sql
//
// Aktionen (POST, JSON-Body { action }):
//   public-key  liefert den öffentlichen VAPID-Schlüssel, mit dem die App das Push-Abo erstellt
//   send        verschickt die fälligen Erinnerungen (ruft der Cron-Job jede Minute auf)
// "Verify JWT" muss aus sein, weil der Cron-Job kein Login mitschickt. Ein fremder Aufruf von
// "send" kann nur Erinnerungen verschicken, die ohnehin gerade fällig sind.
//
// Web Push (RFC 8291 Verschlüsselung, RFC 8292 VAPID) ist hier mit Web Crypto umgesetzt, ohne
// npm-Bibliothek: npm:web-push startete in Supabase nicht (504).
//
// Termintitel sind Ende-zu-Ende verschlüsselt. Lesbar sind sie hier nur, wenn die Person in den
// Optionen "Titel zeigen" eingeschaltet hat; sonst heisst die Erinnerung "Termin".
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys),
// optional VAPID_SUBJECT (mailto:…) und FEED_TIMEZONE (Standard Europe/Zurich).

import { createClient } from 'npm:@supabase/supabase-js@2';

const TIME_ZONE = Deno.env.get('FEED_TIMEZONE') ?? 'Europe/Zurich';
const PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

interface Due {
  event_id: string;
  user_id: string;
  title: string;
  starts_at: string;
  all_day: boolean;
  remind_at: string;
}

// ---- End-to-end encrypted titles ----
// Titles and descriptions arrive encrypted ("e1:<scope>:<base64(iv | ciphertext)>", see
// src/app/features/crypto/e2ee.ts). Only users who switched on "Titel zeigen" in the options left
// their calendar keys here (table feed_keys); for everyone else the text stays unreadable.

type FeedKeys = Map<string, Map<string, Promise<CryptoKey>>>; // user → scope → key

async function loadFeedKeys(userIds: string[]): Promise<FeedKeys> {
  const keys: FeedKeys = new Map();
  if (!userIds.length) return keys;
  const { data, error } = await admin.from('feed_keys').select('user_id, scope_id, calendar_key').in('user_id', userIds);
  if (error) throw error;
  for (const row of data ?? []) {
    const raw = Uint8Array.from(atob(row.calendar_key), (c) => c.charCodeAt(0));
    if (!keys.has(row.user_id)) keys.set(row.user_id, new Map());
    keys.get(row.user_id)!.set(row.scope_id, crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']));
  }
  return keys;
}

// Plain text as it is, decrypted text with the user's key, otherwise null
async function readable(value: string | null, keys: Map<string, Promise<CryptoKey>> | undefined): Promise<string | null> {
  if (value === null || !value.startsWith('e1:')) return value;
  const end = value.indexOf(':', 3);
  const scope = value.slice(3, end);
  const key = keys?.get(scope);
  if (end < 0 || !key) return null;
  try {
    const bytes = Uint8Array.from(atob(value.slice(end + 1)), (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: new TextEncoder().encode(scope) },
      await key,
      bytes.subarray(12)
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

interface Subscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

// "Heute, 14:30", "Morgen, ganztägig", "Fr., 30. Okt., 09:00"
export function whenText(startsAt: string, allDay: boolean, now = new Date()): string {
  const start = new Date(startsAt);
  const day = (d: Date) => new Intl.DateTimeFormat('de-CH', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const today = day(now);
  const tomorrow = day(new Date(now.getTime() + 86400000));
  const label = day(start) === today
    ? 'Heute'
    : day(start) === tomorrow
      ? 'Morgen'
      : new Intl.DateTimeFormat('de-CH', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' }).format(start);
  const time = allDay
    ? 'ganztägig'
    : new Intl.DateTimeFormat('de-CH', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(start);
  return `${label}, ${time}`;
}

// ---- Web Push ----

const encoder = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;

function fromB64url(text: string): Bytes {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function toB64url(bytes: Bytes): string {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// Payload encryption with "aes128gcm" (RFC 8291 / RFC 8188), one record
export async function encryptPayload(payload: string, p256dh: string, authSecret: string, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<Bytes> {
  const uaPublic = fromB64url(p256dh);
  const auth = fromB64url(authSecret);
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(auth, shared, concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(encoder.encode(payload), new Uint8Array([2])); // 2 = last record
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

// VAPID: a JWT signed with the server key so the push service knows who sends (RFC 8292)
async function vapidHeader(endpoint: string): Promise<string> {
  const pub = fromB64url(PUBLIC_KEY);
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: PRIVATE_KEY, x: toB64url(pub.slice(1, 33)), y: toB64url(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const part = (value: object) => toB64url(encoder.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:fortwo@example.com',
  })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned)));
  return `vapid t=${unsigned}.${toB64url(signature)}, k=${PUBLIC_KEY}`;
}

// Returns the push service's status code (201 = accepted, 404/410 = device gone)
async function sendPush(s: Subscription, payload: string): Promise<number> {
  const response = await fetch(s.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(s.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'high',
    },
    body: await encryptPayload(payload, s.p256dh, s.auth),
    signal: AbortSignal.timeout(10000),
  });
  await response.body?.cancel();
  return response.status;
}

async function send(): Promise<Response> {
  if (!PUBLIC_KEY || !PRIVATE_KEY) return reply(500, { error: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY fehlen' });

  const { data: due, error } = await admin.rpc('due_reminders');
  if (error) return reply(500, { error: error.message });
  if (!due?.length) return reply(200, { sent: 0 });

  // Mark them first, so an overlapping run does not send them twice
  const { data: claimed, error: claimError } = await admin
    .from('reminder_deliveries')
    .upsert(
      (due as Due[]).map((d) => ({ event_id: d.event_id, user_id: d.user_id, remind_at: d.remind_at })),
      { onConflict: 'event_id,user_id,remind_at', ignoreDuplicates: true }
    )
    .select('event_id, user_id, remind_at');
  if (claimError) return reply(500, { error: claimError.message });
  const mine = new Set((claimed ?? []).map((c) => `${c.event_id}|${c.user_id}|${new Date(c.remind_at).getTime()}`));
  const reminders = (due as Due[]).filter((d) => mine.has(`${d.event_id}|${d.user_id}|${new Date(d.remind_at).getTime()}`));

  const users = [...new Set(reminders.map((r) => r.user_id))];
  const { data: subs, error: subError } = await admin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', users);
  if (subError) return reply(500, { error: subError.message });

  let keys: FeedKeys;
  try {
    keys = await loadFeedKeys(users);
  } catch (e) {
    return reply(500, { error: (e as Error).message });
  }
  const titles = new Map(
    await Promise.all(reminders.map(async (r) => [`${r.event_id}|${r.user_id}`, (await readable(r.title, keys.get(r.user_id))) ?? 'Termin'] as const))
  );

  let sent = 0;
  const gone = new Set<string>();
  await Promise.all(
    reminders.flatMap((r) =>
      (subs as Subscription[])
        .filter((s) => s.user_id === r.user_id)
        .map(async (s) => {
          // Format understood by the Angular service worker (ngsw)
          const payload = {
            notification: {
              title: titles.get(`${r.event_id}|${r.user_id}`)!,
              body: whenText(r.starts_at, r.all_day),
              icon: 'icons/pwa-icon-192x192.png',
              badge: 'icons/favicon-96x96.png',
              tag: `${r.event_id}|${r.remind_at}`,
              data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: '/calendar' } } },
            },
          };
          try {
            const status = await sendPush(s, JSON.stringify(payload));
            if (status >= 200 && status < 300) sent++;
            else if (status === 404 || status === 410) gone.add(s.id); // the device unsubscribed
            else console.error('Push abgelehnt', status, new URL(s.endpoint).host);
          } catch (e) {
            console.error('Push fehlgeschlagen', new URL(s.endpoint).host, (e as Error).message);
          }
        })
    )
  );
  if (gone.size) await admin.from('push_subscriptions').delete().in('id', [...gone]);
  return reply(200, { sent, removedDevices: gone.size });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Nur POST' });
  const { action } = await req.json().catch(() => ({ action: null }));
  switch (action) {
    case 'public-key':
      return PUBLIC_KEY ? reply(200, { publicKey: PUBLIC_KEY }) : reply(500, { error: 'VAPID_PUBLIC_KEY fehlt' });
    case 'send':
      return await send();
    default:
      return reply(400, { error: 'Unbekannte Aktion' });
  }
});
