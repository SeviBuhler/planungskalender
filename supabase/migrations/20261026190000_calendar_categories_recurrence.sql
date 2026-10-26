-- Kalender: Kategorien und wiederkehrende Termine.
-- Eine Serie besteht aus einzelnen Terminen mit derselben series_id, damit jeder
-- Termin einzeln geändert werden kann und die 5-Jahre-Löschung weiter greift.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

alter table public.calendar_events
    add column category text
        check (category in ('work', 'private', 'family', 'health', 'leisure', 'other')),
    add column series_id uuid,
    add column recurrence text
        check (recurrence in ('daily', 'weekly', 'biweekly', 'monthly', 'yearly')),
    add column recurrence_until date,
    add check ((series_id is null) = (recurrence is null) and (recurrence is null) = (recurrence_until is null));

create index calendar_events_series_idx on public.calendar_events (series_id);

grant update (category, series_id, recurrence, recurrence_until) on public.calendar_events to authenticated;
