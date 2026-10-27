-- Einkaufsliste: in welchen Läden jemand einkauft (Preise und Aktionen kommen von der
-- Edge Function supabase/functions/store-prices). Jede Person wählt für sich.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

create table public.store_preferences (
    user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
    chains text[] not null default '{}'
        check (chains <@ array['migros', 'aldi', 'denner', 'lidl']::text[] and cardinality(chains) <= 10),
    updated_at timestamptz not null default now()
);

alter table public.store_preferences enable row level security;
create policy "Eigene Läden lesen" on public.store_preferences for select to authenticated using (user_id = auth.uid());
create policy "Eigene Läden anlegen" on public.store_preferences for insert to authenticated with check (user_id = auth.uid());
create policy "Eigene Läden ändern" on public.store_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.store_preferences from anon, authenticated;
grant select, insert, update (chains, updated_at) on public.store_preferences to authenticated;
