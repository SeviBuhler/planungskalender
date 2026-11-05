-- Kalender: Teilnehmende eines Termins. Alle Mitglieder eines Haushalts sehen einen geteilten
-- Termin, Erinnerungen bekommen aber nur die Teilnehmenden. Wer den Termin erstellt hat, nimmt
-- immer teil und ist die einzige Person, die die Teilnehmenden ändern darf.
-- Bestehende Termine: die Besitzer:in nimmt teil, bei geteilten Terminen zusätzlich alle
-- heutigen Mitglieder des Haushalts (so verliert niemand eine Erinnerung).
-- Voraussetzung: 20261027140000_push_reminders.sql ist ausgeführt.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

create table public.event_participants (
    event_id uuid not null references public.calendar_events (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    primary key (event_id, user_id)
);

create index event_participants_user_idx on public.event_participants (user_id);

alter table public.event_participants enable row level security;

-- Lesen: wer den Termin sieht (Besitzer:in oder Mitglied des Haushalts)
create policy "Teilnehmende sehen" on public.event_participants
    for select to authenticated
    using (exists (
        select 1 from public.calendar_events e
        where e.id = event_id
          and (e.owner_id = auth.uid() or (e.household_id is not null and public.is_household_member(e.household_id)))
    ));

-- Eintragen: nur die Besitzer:in, und nur Mitglieder des Haushalts des Termins
create policy "Teilnehmende eintragen" on public.event_participants
    for insert to authenticated
    with check (exists (
        select 1 from public.calendar_events e
        where e.id = event_id
          and e.owner_id = auth.uid()
          and (
              user_id = auth.uid()
              or (e.household_id is not null and exists (
                  select 1 from public.household_members m
                  where m.household_id = e.household_id and m.user_id = event_participants.user_id
              ))
          )
    ));

-- Austragen: nur die Besitzer:in, sich selbst kann sie nicht austragen
create policy "Teilnehmende austragen" on public.event_participants
    for delete to authenticated
    using (exists (
        select 1 from public.calendar_events e
        where e.id = event_id and e.owner_id = auth.uid() and e.owner_id <> event_participants.user_id
    ));

revoke update on public.event_participants from anon, authenticated;

-- Die Besitzer:in nimmt immer teil: beim Erstellen und wenn ein Termin bei einer Kontolöschung
-- an ein anderes Mitglied übergeht. Wechselt der Termin den Haushalt oder wird er privat,
-- bleibt nur die Besitzer:in.
create function public.sync_event_owner_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' and new.household_id is distinct from old.household_id then
        delete from public.event_participants where event_id = new.id and user_id <> new.owner_id;
    end if;
    insert into public.event_participants (event_id, user_id) values (new.id, new.owner_id)
    on conflict do nothing;
    return null;
end;
$$;

revoke all on function public.sync_event_owner_participant() from public, anon, authenticated;

create trigger calendar_events_owner_participant
    after insert or update of owner_id, household_id on public.calendar_events
    for each row execute function public.sync_event_owner_participant();

-- Wer einen Haushalt verlässt, nimmt an dessen Terminen nicht mehr teil
create function public.remove_participations_on_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    delete from public.event_participants p
    using public.calendar_events e
    where p.event_id = e.id
      and e.household_id = old.household_id
      and p.user_id = old.user_id
      and e.owner_id <> old.user_id;
    return null;
end;
$$;

revoke all on function public.remove_participations_on_leave() from public, anon, authenticated;

create trigger household_members_remove_participations
    after delete on public.household_members
    for each row execute function public.remove_participations_on_leave();

-- Bestehende Termine
insert into public.event_participants (event_id, user_id)
select id, owner_id from public.calendar_events
on conflict do nothing;

insert into public.event_participants (event_id, user_id)
select e.id, m.user_id
from public.calendar_events e
join public.household_members m on m.household_id = e.household_id
on conflict do nothing;

-- Namen der Mitglieder aller eigenen Haushalte, für die Auswahl der Teilnehmenden
create function public.household_member_names()
returns table (household_id uuid, user_id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
    select m.household_id, m.user_id,
           coalesce(
               nullif(trim(p.display_name), ''),
               nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
               split_part(u.email, '@', 1)
           )
    from public.household_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    where public.is_household_member(m.household_id)
    order by m.joined_at;
$$;

revoke execute on function public.household_member_names() from public, anon;
grant execute on function public.household_member_names() to authenticated;

-- Erinnerungen: bei privaten Terminen die Besitzer:in, bei geteilten nur die Teilnehmenden,
-- die noch Mitglied sind (und nur, wenn der Haushalt das Modul Kalender nutzt)
create or replace function public.due_reminders()
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
        select d.*, p.user_id from due d
        join public.households h on h.id = d.household_id and 'calendar' = any (h.modules)
        join public.event_participants p on p.event_id = d.id
        join public.household_members m on m.household_id = d.household_id and m.user_id = p.user_id
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
