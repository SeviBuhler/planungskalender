-- Finanzpläne: privat (nur Besitzer:in) oder einem Haushalt zugeordnet (alle Mitglieder).
-- Ein Haushalt ist damit freiwillig. Eine Person kann in mehreren Haushalten sein.
-- Bestehende Haushalts-Budgets werden in einen Plan "Gemeinsamer Plan" übernommen.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

alter table public.households add column name text not null default 'Haushalt';
alter table public.household_members drop constraint household_members_user_id_key;

create table public.finance_plans (
    id uuid primary key default gen_random_uuid(),
    name text not null check (length(trim(name)) > 0),
    owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    household_id uuid references public.households (id) on delete set null, -- null = privat
    created_at timestamptz not null default now()
);

create index finance_plans_owner_idx on public.finance_plans (owner_id);
create index finance_plans_household_idx on public.finance_plans (household_id);

-- Bestehende Daten: ein geteilter Plan pro Haushalt, Besitzer:in ist das erste Mitglied
insert into public.finance_plans (name, owner_id, household_id)
select 'Gemeinsamer Plan', first_member.user_id, h.id
from public.households h
cross join lateral (
    select m.user_id from public.household_members m
    where m.household_id = h.id
    order by m.joined_at
    limit 1
) first_member
where exists (select 1 from public.month_budgets b where b.household_id = h.id);

alter table public.month_budgets add column plan_id uuid references public.finance_plans (id) on delete cascade;
update public.month_budgets b
set plan_id = p.id
from public.finance_plans p
where p.household_id = b.household_id;

drop policy "Mitglieder lesen Budgets" on public.month_budgets;
drop policy "Mitglieder erstellen Budgets" on public.month_budgets;
drop policy "Mitglieder ändern Budgets" on public.month_budgets;
drop policy "Mitglieder löschen Budgets" on public.month_budgets;

-- Budgets eines Haushalts ohne Mitglieder sind für niemanden mehr erreichbar
delete from public.month_budgets where plan_id is null;

alter table public.month_budgets drop constraint month_budgets_pkey;
alter table public.month_budgets drop column household_id;
alter table public.month_budgets alter column plan_id set not null;
alter table public.month_budgets add primary key (plan_id, month);

-- Zugriff auf einen Plan: eigener Plan oder Plan eines Haushalts, in dem man Mitglied ist
create function public.can_access_plan(p uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.finance_plans fp
        where fp.id = p
          and (
              fp.owner_id = auth.uid()
              or (fp.household_id is not null and exists (
                  select 1 from public.household_members m
                  where m.household_id = fp.household_id and m.user_id = auth.uid()
              ))
          )
    );
$$;

revoke execute on function public.can_access_plan(uuid) from public, anon;
grant execute on function public.can_access_plan(uuid) to authenticated;

alter table public.finance_plans enable row level security;

create policy "Pläne sehen" on public.finance_plans
    for select to authenticated
    using (owner_id = auth.uid() or (household_id is not null and public.is_household_member(household_id)));

create policy "Eigene Pläne erstellen" on public.finance_plans
    for insert to authenticated
    with check (owner_id = auth.uid() and (household_id is null or public.is_household_member(household_id)));

-- Nur die Besitzer:in benennt um, teilt mit einem Haushalt oder macht den Plan wieder privat
create policy "Eigene Pläne ändern" on public.finance_plans
    for update to authenticated
    using (owner_id = auth.uid())
    with check (owner_id = auth.uid() and (household_id is null or public.is_household_member(household_id)));

create policy "Eigene Pläne löschen" on public.finance_plans
    for delete to authenticated using (owner_id = auth.uid());

create policy "Budgets lesen" on public.month_budgets
    for select to authenticated using (public.can_access_plan(plan_id));

create policy "Budgets erstellen" on public.month_budgets
    for insert to authenticated with check (public.can_access_plan(plan_id));

create policy "Budgets ändern" on public.month_budgets
    for update to authenticated
    using (public.can_access_plan(plan_id))
    with check (public.can_access_plan(plan_id));

create policy "Budgets löschen" on public.month_budgets
    for delete to authenticated using (public.can_access_plan(plan_id));

-- create_household() legte bisher höchstens einen Haushalt pro Person an
drop function public.create_household();

create function public.create_household(household_name text default 'Haushalt')
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
    result public.households;
begin
    if auth.uid() is null then
        raise exception 'Nicht angemeldet';
    end if;

    insert into public.households (name)
    values (coalesce(nullif(trim(household_name), ''), 'Haushalt'))
    returning * into result;
    insert into public.household_members (household_id, user_id) values (result.id, auth.uid());
    return result;
end;
$$;

create or replace function public.join_household(code text)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
    result public.households;
begin
    if auth.uid() is null then
        raise exception 'Nicht angemeldet';
    end if;

    select * into result from public.households where invite_code = upper(trim(code));
    if not found then
        raise exception 'Einladungscode ungültig';
    end if;

    if exists (select 1 from public.household_members where user_id = auth.uid() and household_id = result.id) then
        return result;
    end if;

    -- Sperrt den Haushalt, damit zwei gleichzeitige Beitritte nicht beide durchkommen
    perform 1 from public.households where id = result.id for update;
    if (select count(*) from public.household_members where household_id = result.id) >= 2 then
        raise exception 'Dieser Haushalt hat bereits zwei Personen';
    end if;

    insert into public.household_members (household_id, user_id) values (result.id, auth.uid());
    return result;
end;
$$;

revoke execute on function public.create_household(text) from public, anon;
grant execute on function public.create_household(text) to authenticated;
