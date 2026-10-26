-- Kalender-Abo: ein geheimer Link pro Benutzer, über den iPhone, Google oder Outlook die
-- ForTwo-Termine als iCal-Abo lesen (nur lesbar). Die Edge Function "calendar-feed" liefert
-- die Termine zu einem Link aus; wer den Link kennt, sieht die Termine, deshalb kann er
-- jederzeit erneuert oder gelöscht werden.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

create table public.calendar_feeds (
    user_id uuid primary key references auth.users (id) on delete cascade,
    token text not null unique,
    created_at timestamptz not null default now(),
    last_fetched_at timestamptz
);

alter table public.calendar_feeds enable row level security;

create policy "Eigenes Kalender-Abo sehen" on public.calendar_feeds
    for select to authenticated using (user_id = auth.uid());

create policy "Eigenes Kalender-Abo löschen" on public.calendar_feeds
    for delete to authenticated using (user_id = auth.uid());

-- Erstellt den Link oder ersetzt ihn durch einen neuen (der alte funktioniert danach nicht mehr)
create function public.renew_calendar_feed()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    new_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
    if auth.uid() is null then
        raise exception 'Nicht angemeldet';
    end if;

    insert into public.calendar_feeds (user_id, token) values (auth.uid(), new_token)
    on conflict (user_id) do update set token = excluded.token, created_at = now(), last_fetched_at = null;
    return new_token;
end;
$$;

revoke execute on function public.renew_calendar_feed() from public, anon;
grant execute on function public.renew_calendar_feed() to authenticated;
