// Kalender-Abo für ForTwo: liefert die Termine eines Benutzers als iCal-Datei, damit iPhone,
// Google oder Outlook sie abonnieren können (nur lesbar). Tabelle und Link-Erzeugung:
// supabase/migrations/20261026230000_calendar_feeds.sql
//
// GET /functions/v1/calendar-feed?token=<geheimer Link-Teil>
// Kalender-Apps senden kein Login mit, deshalb muss "Verify JWT" für diese Function aus sein.
// Der Token ersetzt das Login.
//
// Enthalten sind private Termine und die Termine der Haushalte mit Modul Kalender, von einem
// Jahr zurück bis drei Jahre voraus. Zeitzone für ganztägige Termine: FEED_TIMEZONE oder Europe/Zurich.
//
// Titel sind Ende-zu-Ende verschlüsselt. Lesbar sind sie hier nur, wenn die Person in den Optionen
// "Titel zeigen" eingeschaltet hat; sonst heisst jeder Termin "Termin".

import { createClient } from 'npm:@supabase/supabase-js@2';

// ---- iCalendar (RFC 5545) ----
interface FeedEvent {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string; // exclusive; for all-day events the start of the day after the last day
  all_day: boolean;
  category: string | null;
  household: string | null; // name of the household the event is shared with
  reminder_minutes: number | null; // minutes before the start, negative = after
  created_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  work: 'Arbeit',
  private: 'Privat',
  family: 'Familie',
  health: 'Gesundheit',
  leisure: 'Freizeit',
  birthday: 'Geburtstag',
  other: 'Sonstiges',
};

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Lines longer than 75 octets continue on the next line after a space
function fold(line: string): string {
  const bytes = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  for (const char of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes.encode(current + char).length > limit) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function utcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// All-day events are stored as local midnight; the date is taken in the user's time zone
function localDate(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}${get('month')}${get('day')}`;
}

// Offset from the start: -PT15M is 15 minutes before, PT9H is 9 hours after
function trigger(minutesBefore: number): string {
  const minutes = Math.abs(minutesBefore);
  const duration = minutes === 0 ? 'PT0M' : minutes % 60 === 0 ? `PT${minutes / 60}H` : `PT${minutes}M`;
  return minutesBefore > 0 ? `-${duration}` : duration;
}

function buildCalendar(events: FeedEvent[], timeZone: string, now = new Date()): string {
  const stamp = utcStamp(now.toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ForTwo//Kalender//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:ForTwo',
    `X-WR-TIMEZONE:${timeZone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const event of events) {
    const details = [event.household ? `Haushalt „${event.household}“` : null, event.description].filter(Boolean);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@fortwo`,
      `DTSTAMP:${stamp}`,
      `CREATED:${utcStamp(event.created_at)}`,
      ...(event.all_day
        ? [`DTSTART;VALUE=DATE:${localDate(event.starts_at, timeZone)}`, `DTEND;VALUE=DATE:${localDate(event.ends_at, timeZone)}`]
        : [`DTSTART:${utcStamp(event.starts_at)}`, `DTEND:${utcStamp(event.ends_at)}`]),
      `SUMMARY:${escapeText(event.title)}`,
      ...(details.length ? [`DESCRIPTION:${escapeText(details.join('\n\n'))}`] : []),
      ...(event.category ? [`CATEGORIES:${escapeText(CATEGORY_LABELS[event.category] ?? event.category)}`] : []),
      ...(event.reminder_minutes === null
        ? []
        : ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(event.title)}`, `TRIGGER:${trigger(event.reminder_minutes)}`, 'END:VALARM']),
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---- Request ----

const TIME_ZONE = Deno.env.get('FEED_TIMEZONE') ?? 'Europe/Zurich';
const PAST_DAYS = 365;
const FUTURE_DAYS = 3 * 365;
const MAX_EVENTS = 5000;

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

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

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, 'Nur GET');

  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!/^[0-9a-f]{64}$/.test(token)) return text(404, 'Kalender nicht gefunden');

  const { data: feed, error: feedError } = await admin
    .from('calendar_feeds')
    .select('user_id')
    .eq('token', token)
    .maybeSingle();
  if (feedError) return text(500, feedError.message);
  if (!feed) return text(404, 'Kalender nicht gefunden');

  const { data: memberships, error: memberError } = await admin
    .from('household_members')
    .select('households(id, name, modules)')
    .eq('user_id', feed.user_id);
  if (memberError) return text(500, memberError.message);

  // Same rule as the app: shared events only from households that use the calendar module
  const households = new Map<string, string>();
  for (const row of memberships ?? []) {
    const h = row.households as unknown as { id: string; name: string; modules: string[] } | null;
    if (h?.modules?.includes('calendar')) households.set(h.id, h.name);
  }

  const now = Date.now();
  const from = new Date(now - PAST_DAYS * 86400000).toISOString();
  const to = new Date(now + FUTURE_DAYS * 86400000).toISOString();
  const visibility = [
    `and(owner_id.eq.${feed.user_id},household_id.is.null)`,
    ...(households.size ? [`household_id.in.(${[...households.keys()].join(',')})`] : []),
  ].join(',');

  const { data: rows, error: eventError } = await admin
    .from('calendar_events')
    .select('id, title, description, starts_at, ends_at, all_day, category, household_id, created_at, reminder_minutes')
    .or(visibility)
    .lt('starts_at', to)
    .gte('ends_at', from)
    .order('starts_at')
    .limit(MAX_EVENTS);
  if (eventError) return text(500, eventError.message);

  const keys = (await loadFeedKeys([feed.user_id])).get(feed.user_id);
  const events: FeedEvent[] = await Promise.all(
    (rows ?? []).map(async (r) => {
      const title = await readable(r.title, keys);
      return {
        ...r,
        title: title ?? 'Termin',
        description: title === null ? null : await readable(r.description, keys),
        household: r.household_id ? households.get(r.household_id) ?? null : null,
      };
    })
  );

  await admin.from('calendar_feeds').update({ last_fetched_at: new Date().toISOString() }).eq('user_id', feed.user_id);

  return new Response(req.method === 'HEAD' ? null : buildCalendar(events, TIME_ZONE), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="fortwo.ics"',
      'Cache-Control': 'private, max-age=900',
    },
  });
});
