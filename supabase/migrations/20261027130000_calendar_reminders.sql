-- Kalender: Erinnerung pro Termin, in Minuten vor dem Beginn (negativ = nach dem Beginn,
-- z. B. -540 = ganztägiger Termin, am Tag um 9 Uhr). null = keine Erinnerung.
-- Der Abo-Link gibt sie an den Handy-Kalender weiter; die Push-Erinnerungen der App nutzen sie auch.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

alter table public.calendar_events
    add column reminder_minutes integer check (reminder_minutes between -1440 and 40320);

grant update (reminder_minutes) on public.calendar_events to authenticated;
