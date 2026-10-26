-- Kalender: Termine sind privat oder gehören zu einem Haushalt mit Modul Kalender.
-- Termine, die seit mehr als 5 Jahren vorbei sind, werden täglich gelöscht (pg_cron).
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

create table public.calendar_events (
    id uuid primary key default gen_random_uuid(),
    title text not null check (length(trim(title)) > 0),
    description text,
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    all_day boolean not null default false,
    owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    household_id uuid references public.households (id) on delete cascade, -- null = privat
    created_at timestamptz not null default now(),
    check (ends_at >= starts_at)
);

create index calendar_events_range_idx on public.calendar_events (starts_at, ends_at);
create index calendar_events_owner_idx on public.calendar_events (owner_id);
create index calendar_events_household_idx on public.calendar_events (household_id);

alter table public.calendar_events enable row level security;

-- Eigene Termine oder Termine eines Haushalts, in dem man Mitglied ist.
-- Geteilte Termine dürfen alle Mitglieder bearbeiten.
create policy "Termine sehen" on public.calendar_events
    for select to authenticated
    using (owner_id = auth.uid() or (household_id is not null and public.is_household_member(household_id)));

create policy "Termine erstellen" on public.calendar_events
    for insert to authenticated
    with check (owner_id = auth.uid() and (household_id is null or public.is_household_member(household_id)));

create policy "Termine ändern" on public.calendar_events
    for update to authenticated
    using (owner_id = auth.uid() or (household_id is not null and public.is_household_member(household_id)))
    with check (
        (owner_id = auth.uid() and household_id is null)
        or (household_id is not null and public.is_household_member(household_id))
    );

create policy "Termine löschen" on public.calendar_events
    for delete to authenticated
    using (owner_id = auth.uid() or (household_id is not null and public.is_household_member(household_id)));

-- Besitzer:in eines Termins bleibt fest, auch wenn ein Mitglied ihn bearbeitet
revoke update on public.calendar_events from anon, authenticated;
grant update (title, description, starts_at, ends_at, all_day, household_id) on public.calendar_events to authenticated;

-- Nur die Besitzer:in verschiebt einen Termin in einen anderen Haushalt oder macht ihn privat
create function public.check_calendar_event_move()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.household_id is distinct from old.household_id and old.owner_id <> auth.uid() then
        raise exception 'Nur wer den Termin erstellt hat, kann ihn verschieben oder privat machen';
    end if;
    return new;
end;
$$;

create trigger calendar_events_check_move
    before update on public.calendar_events
    for each row execute function public.check_calendar_event_move();

-- Verlassen eines Haushalts: eigene geteilte Termine werden wieder privat
create or replace function public.leave_household(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'Nicht angemeldet';
    end if;

    update public.finance_plans set household_id = null
    where household_id = target and owner_id = auth.uid();

    update public.calendar_events set household_id = null
    where household_id = target and owner_id = auth.uid();

    delete from public.household_members where household_id = target and user_id = auth.uid();

    if not exists (select 1 from public.household_members where household_id = target) then
        delete from public.households where id = target;
    end if;
end;
$$;

create function public.purge_old_calendar_events()
returns void
language sql
security definer
set search_path = ''
as $$
    delete from public.calendar_events where ends_at < now() - interval '5 years';
$$;

revoke execute on function public.purge_old_calendar_events() from public, anon, authenticated;

-- Tägliche Löschung um 03:00 UTC. Falls pg_cron nicht verfügbar ist, läuft die
-- Migration trotzdem durch; dann im Dashboard unter Integrations → Cron aktivieren
-- und diesen Block erneut ausführen.
do $$
begin
    create extension if not exists pg_cron;
    perform cron.schedule('purge-old-calendar-events', '0 3 * * *', 'select public.purge_old_calendar_events()');
exception when others then
    raise notice 'pg_cron nicht verfügbar (%), alte Termine werden nicht automatisch gelöscht', sqlerrm;
end;
$$;
