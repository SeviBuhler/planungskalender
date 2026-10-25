-- Finanzplanung: gemeinsamer Haushalt für zwei Personen und Monatsbudgets.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

create table public.households (
    id uuid primary key default gen_random_uuid(),
    invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
    created_at timestamptz not null default now()
);

create table public.household_members (
    household_id uuid not null references public.households (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    joined_at timestamptz not null default now(),
    primary key (household_id, user_id),
    unique (user_id) -- jede Person gehört zu genau einem Haushalt
);

create table public.month_budgets (
    household_id uuid not null references public.households (id) on delete cascade,
    month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    data jsonb not null,
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users (id) on delete set null default auth.uid(),
    primary key (household_id, month)
);

-- Prüft die Mitgliedschaft ohne RLS-Rekursion auf household_members
create function public.is_household_member(h uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.household_members
        where household_id = h and user_id = auth.uid()
    );
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.month_budgets enable row level security;

create policy "Mitglieder sehen ihren Haushalt" on public.households
    for select to authenticated using (public.is_household_member(id));

create policy "Mitglieder sehen ihre Mitglieder" on public.household_members
    for select to authenticated using (public.is_household_member(household_id));

create policy "Mitglieder lesen Budgets" on public.month_budgets
    for select to authenticated using (public.is_household_member(household_id));

create policy "Mitglieder erstellen Budgets" on public.month_budgets
    for insert to authenticated with check (public.is_household_member(household_id));

create policy "Mitglieder ändern Budgets" on public.month_budgets
    for update to authenticated
    using (public.is_household_member(household_id))
    with check (public.is_household_member(household_id));

create policy "Mitglieder löschen Budgets" on public.month_budgets
    for delete to authenticated using (public.is_household_member(household_id));

create function public.touch_month_budget()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := now();
    new.updated_by := auth.uid();
    return new;
end;
$$;

create trigger month_budgets_touch
    before update on public.month_budgets
    for each row execute function public.touch_month_budget();

-- Haushalte werden nur über diese Funktionen angelegt bzw. betreten,
-- direkte Inserts auf households/household_members sind durch RLS gesperrt.

create function public.create_household()
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

    select h.* into result
    from public.households h
    join public.household_members m on m.household_id = h.id
    where m.user_id = auth.uid();

    if found then
        return result;
    end if;

    insert into public.households default values returning * into result;
    insert into public.household_members (household_id, user_id) values (result.id, auth.uid());
    return result;
end;
$$;

create function public.join_household(code text)
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

    if exists (select 1 from public.household_members where user_id = auth.uid()) then
        raise exception 'Du bist bereits in einem anderen Haushalt';
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

revoke execute on function public.create_household() from public, anon;
revoke execute on function public.join_household(text) from public, anon;
revoke execute on function public.is_household_member(uuid) from public, anon;
grant execute on function public.create_household() to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;
