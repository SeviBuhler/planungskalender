-- Kalender-Import (.ics / .csv): importierte Termine merken sich ihren Schlüssel aus der Datei,
-- damit ein erneuter Import derselben Datei die Termine aktualisiert statt sie doppelt anzulegen.
-- Serien mit Regeln, die ForTwo nicht selbst anbietet (z. B. jeden Mo und Mi), haben eine
-- series_id, aber keine recurrence.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

alter table public.calendar_events add column import_key text;

alter table public.calendar_events
    add constraint calendar_events_import_key_unique unique (owner_id, import_key);

grant update (import_key) on public.calendar_events to authenticated;

-- Alte Regel "series_id, recurrence und recurrence_until immer zusammen" lockern
do $$
declare
    c text;
begin
    for c in
        select conname from pg_constraint
        where conrelid = 'public.calendar_events'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid) like '%recurrence_until%'
    loop
        execute format('alter table public.calendar_events drop constraint %I', c);
    end loop;
end;
$$;

alter table public.calendar_events
    add constraint calendar_events_series_check
        check ((series_id is null) = (recurrence_until is null) and (recurrence is null or series_id is not null));
