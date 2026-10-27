// Push-Erinnerungen für ForTwo-Termine. Tabellen und Cron-Job:
// supabase/migrations/20261027140000_push_reminders.sql
//
// Aktionen (POST, JSON-Body { action }):
//   public-key  liefert den öffentlichen VAPID-Schlüssel, mit dem die App das Push-Abo erstellt
//   send        verschickt die fälligen Erinnerungen (ruft der Cron-Job jede Minute auf)
// "Verify JWT" muss aus sein, weil der Cron-Job kein Login mitschickt. Ein fremder Aufruf von
// "send" kann nur Erinnerungen verschicken, die ohnehin gerade fällig sind.
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys),
// optional VAPID_SUBJECT (mailto:…) und FEED_TIMEZONE (Standard Europe/Zurich).

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

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

async function send(): Promise<Response> {
  if (!PUBLIC_KEY || !PRIVATE_KEY) return reply(500, { error: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY fehlen' });
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:fortwo@example.com', PUBLIC_KEY, PRIVATE_KEY);

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
              title: r.title,
              body: whenText(r.starts_at, r.all_day),
              icon: 'icons/pwa-icon-192x192.png',
              badge: 'icons/favicon-96x96.png',
              tag: `${r.event_id}|${r.remind_at}`,
              data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: '/calendar' } } },
            },
          };
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
            sent++;
          } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) gone.add(s.id); // the device unsubscribed
            else console.error('Push fehlgeschlagen', status, (e as Error).message);
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
