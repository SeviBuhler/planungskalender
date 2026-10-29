-- Kalender: Kategorie "Geburtstag" und optionales Geburtsjahr (zeigt im Kalender "wird 30").
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

alter table public.calendar_events drop constraint if exists calendar_events_category_check;
alter table public.calendar_events
    add constraint calendar_events_category_check
        check (category in ('work', 'private', 'family', 'health', 'leisure', 'birthday', 'other')),
    add column birth_year smallint check (birth_year between 1900 and 2200);

grant update (birth_year) on public.calendar_events to authenticated;
