-- Einkaufslisten: privat oder mit einem Haushalt mit Modul Einkaufsliste geteilt.
-- Die Besitzer:in benennt um, teilt oder löscht die Liste; Artikel bearbeiten alle, die die Liste sehen.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

-- Das Modul war bisher noch nicht verfügbar: bestehende und neue Haushalte bekommen es eingeschaltet
alter table public.households alter column modules set default array['finance', 'calendar', 'shopping'];
update public.households set modules = array_append(modules, 'shopping') where not 'shopping' = any (modules);

create table public.shopping_lists (
    id uuid primary key default gen_random_uuid(),
    name text not null check (length(trim(name)) > 0),
    owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    household_id uuid references public.households (id) on delete cascade, -- null = privat
    created_at timestamptz not null default now()
);

create index shopping_lists_owner_idx on public.shopping_lists (owner_id);
create index shopping_lists_household_idx on public.shopping_lists (household_id);

create table public.shopping_items (
    id uuid primary key default gen_random_uuid(),
    list_id uuid not null references public.shopping_lists (id) on delete cascade,
    name text not null check (length(trim(name)) > 0),
    quantity text,
    checked boolean not null default false,
    created_by uuid default auth.uid() references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    checked_at timestamptz
);

create index shopping_items_list_idx on public.shopping_items (list_id);

-- Zugriff auf eine Liste: eigene Liste oder Liste eines Haushalts, in dem man Mitglied ist
create function public.can_access_shopping_list(l uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.shopping_lists sl
        where sl.id = l
          and (
              sl.owner_id = auth.uid()
              or (sl.household_id is not null and exists (
                  select 1 from public.household_members m
                  where m.household_id = sl.household_id and m.user_id = auth.uid()
              ))
          )
    );
$$;

revoke execute on function public.can_access_shopping_list(uuid) from public, anon;
grant execute on function public.can_access_shopping_list(uuid) to authenticated;

alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;

create policy "Listen sehen" on public.shopping_lists
    for select to authenticated
    using (owner_id = auth.uid() or (household_id is not null and public.is_household_member(household_id)));

create policy "Eigene Listen erstellen" on public.shopping_lists
    for insert to authenticated
    with check (owner_id = auth.uid() and (household_id is null or public.is_household_member(household_id)));

create policy "Eigene Listen ändern" on public.shopping_lists
    for update to authenticated
    using (owner_id = auth.uid())
    with check (owner_id = auth.uid() and (household_id is null or public.is_household_member(household_id)));

create policy "Eigene Listen löschen" on public.shopping_lists
    for delete to authenticated using (owner_id = auth.uid());

create policy "Artikel sehen" on public.shopping_items
    for select to authenticated using (public.can_access_shopping_list(list_id));

create policy "Artikel erstellen" on public.shopping_items
    for insert to authenticated with check (public.can_access_shopping_list(list_id));

create policy "Artikel ändern" on public.shopping_items
    for update to authenticated
    using (public.can_access_shopping_list(list_id))
    with check (public.can_access_shopping_list(list_id));

create policy "Artikel löschen" on public.shopping_items
    for delete to authenticated using (public.can_access_shopping_list(list_id));

-- Artikel bleiben in ihrer Liste, und wer sie erfasst hat, bleibt fest
revoke update on public.shopping_items from anon, authenticated;
grant update (name, quantity, checked, checked_at) on public.shopping_items to authenticated;

-- Verlassen eines Haushalts: eigene geteilte Pläne, Termine und Listen werden wieder privat
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

    update public.shopping_lists set household_id = null
    where household_id = target and owner_id = auth.uid();

    delete from public.household_members where household_id = target and user_id = auth.uid();

    if not exists (select 1 from public.household_members where household_id = target) then
        delete from public.households where id = target;
    end if;
end;
$$;

-- Live-Updates: Änderungen an Artikeln erscheinen sofort bei allen Mitgliedern.
-- Falls Realtime nicht verfügbar ist, läuft die Migration trotzdem durch;
-- die Liste lädt dann beim Öffnen neu.
alter table public.shopping_items replica identity full;

do $$
begin
    alter publication supabase_realtime add table public.shopping_items;
exception when others then
    raise notice 'Realtime nicht verfügbar (%), Einkaufslisten aktualisieren sich nicht live', sqlerrm;
end;
$$;
