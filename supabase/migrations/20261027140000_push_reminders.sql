-- Push-Erinnerungen der App: jedes Gerät, auf dem man "Erinnerungen auf diesem Gerät" einschaltet,
-- speichert hier sein Push-Abo. Die Edge Function "send-reminders" läuft jede Minute (pg_cron),
-- holt die fälligen Erinnerungen und schickt sie an die Geräte.
-- Voraussetzung: 20261027130000_calendar_reminders.sql ist ausgeführt.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

create table public.push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    device_name text,
    created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "Eigene Geräte für Erinnerungen sehen" on public.push_subscriptions
    for select to authenticated using (user_id = auth.uid());

create policy "Eigene Geräte für Erinnerungen entfernen" on public.push_subscriptions
    for delete to authenticated using (user_id = auth.uid());

-- Speichert das Push-Abo dieses Geräts. Meldet sich auf demselben Gerät jemand anderes an,
-- gehört das Gerät danach der neuen Person.
create function public.save_push_subscription(
    sub_endpoint text,
    sub_p256dh text,
    sub_auth text,
    sub_device_name text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'Nicht angemeldet';
    end if;

    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_name)
    values (auth.uid(), sub_endpoint, sub_p256dh, sub_auth, sub_device_name)
    on conflict (endpoint) do update
        set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
            device_name = excluded.device_name, created_at = now();
end;
$$;

revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- Bereits verschickte Erinnerungen, damit keine doppelt kommt (nur Edge Function)
create table public.reminder_deliveries (
    event_id uuid not null references public.calendar_events (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    remind_at timestamptz not null,
    sent_at timestamptz not null default now(),
    primary key (event_id, user_id, remind_at)
);

alter table public.reminder_deliveries enable row level security;

create index calendar_events_reminder_idx on public.calendar_events (starts_at) where reminder_minutes is not null;

-- Fällige Erinnerungen der letzten 15 Minuten, die noch nicht verschickt wurden.
-- Empfänger: bei privaten Terminen die Besitzer:in, bei geteilten alle Mitglieder des Haushalts
-- (wenn er das Modul Kalender nutzt), jeweils nur mit mindestens einem Gerät.
create function public.due_reminders()
returns table (event_id uuid, user_id uuid, title text, starts_at timestamptz, all_day boolean, remind_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
    with due as (
        select e.id, e.title, e.starts_at, e.all_day, e.owner_id, e.household_id,
               e.starts_at - make_interval(mins => e.reminder_minutes) as remind_at
        from public.calendar_events e
        where e.reminder_minutes is not null
          and e.starts_at between now() - interval '1 day 15 minutes' and now() + interval '28 days 1 minute'
    ),
    recipients as (
        select d.*, d.owner_id as recipient from due d where d.household_id is null
        union all
        select d.*, m.user_id from due d
        join public.households h on h.id = d.household_id and 'calendar' = any (h.modules)
        join public.household_members m on m.household_id = d.household_id
    )
    select r.id, r.recipient, r.title, r.starts_at, r.all_day, r.remind_at
    from recipients r
    where r.remind_at <= now() and r.remind_at > now() - interval '15 minutes'
      and exists (select 1 from public.push_subscriptions s where s.user_id = r.recipient)
      and not exists (
          select 1 from public.reminder_deliveries x
          where x.event_id = r.id and x.user_id = r.recipient and x.remind_at = r.remind_at
      );
$$;

revoke execute on function public.due_reminders() from public, anon, authenticated;
grant execute on function public.due_reminders() to service_role;

-- Jede Minute die Edge Function aufrufen, täglich alte Einträge löschen.
-- Falls pg_cron oder pg_net fehlen: im Dashboard unter Integrations → Cron (und Database →
-- Extensions → pg_net) aktivieren und diesen Block erneut ausführen.
do $$
begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.schedule(
        'send-reminders',
        '* * * * *',
        $job$
            select net.http_post(
                url := 'https://exavrxaxnaezeyoricqa.supabase.co/functions/v1/send-reminders',
                headers := '{"Content-Type": "application/json"}'::jsonb,
                body := '{"action": "send"}'::jsonb
            )
        $job$
    );
    perform cron.schedule(
        'purge-reminder-deliveries',
        '30 3 * * *',
        $job$ delete from public.reminder_deliveries where sent_at < now() - interval '3 days' $job$
    );
exception when others then
    raise notice 'Cron nicht eingerichtet (%), Erinnerungen werden nicht verschickt', sqlerrm;
end;
$$;
