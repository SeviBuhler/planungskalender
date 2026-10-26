-- Aufräumen: die alten Tabellen groups, group_members, events und overlay_prefs
-- stammen aus der Zeit vor den Haushalten und werden vom Code nicht mehr genutzt.
-- Bestehende Termine aus events werden vorher als private Termine nach
-- calendar_events übernommen (Kategorie und Wiederholung gehen dabei verloren).
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

insert into public.calendar_events (title, description, starts_at, ends_at, owner_id)
select
    coalesce(nullif(trim(e.title), ''), 'Termin'),
    e.notes,
    e.start_time,
    greatest(e.end_time, e.start_time),
    e.user_id
from public.events e
where e.user_id is not null
  and e.start_time is not null
  and e.end_time is not null
  and exists (select 1 from auth.users u where u.id = e.user_id);

drop table if exists public.overlay_prefs cascade;
drop table if exists public.events cascade;
drop table if exists public.group_members cascade;
drop table if exists public.groups cascade;
