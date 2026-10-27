-- Einkaufsliste: Volg und Otto's als Läden für Preise und Aktionen (Edge Function store-prices).
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

alter table public.store_preferences drop constraint store_preferences_chains_check;
alter table public.store_preferences add constraint store_preferences_chains_check
    check (chains <@ array['migros', 'coop', 'aldi', 'denner', 'lidl', 'volg', 'ottos']::text[] and cardinality(chains) <= 10);
