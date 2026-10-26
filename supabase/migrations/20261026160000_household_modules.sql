-- Haushalte als übergeordnete Struktur: jeder Haushalt wählt seine Module
-- (Finanzplanung, Kalender, später Einkaufsliste), hat bis zu 50 Mitglieder
-- und kann verlassen werden.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

alter table public.households
    add column modules text[] not null default array['finance', 'calendar']
        check (modules <@ array['finance', 'calendar', 'shopping']),
    add column created_by uuid references auth.users (id) on delete set null default auth.uid();

update public.households h
set created_by = (
    select m.user_id from public.household_members m
    where m.household_id = h.id
    order by m.joined_at
    limit 1
);

-- Mitglieder dürfen Name und Module ändern, aber nicht den Einladungscode
revoke update on public.households from anon, authenticated;
grant update (name, modules) on public.households to authenticated;

create policy "Mitglieder ändern ihren Haushalt" on public.households
    for update to authenticated
    using (public.is_household_member(id))
    with check (public.is_household_member(id));

drop function public.create_household(text);

create function public.create_household(
    household_name text,
    household_modules text[] default array['finance', 'calendar']
)
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

    insert into public.households (name, modules, created_by)
    values (coalesce(nullif(trim(household_name), ''), 'Haushalt'), household_modules, auth.uid())
    returning * into result;
    insert into public.household_members (household_id, user_id) values (result.id, auth.uid());
    return result;
end;
$$;

-- Obergrenze nur gegen Missbrauch, nicht als echte Einschränkung
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

    -- Sperrt den Haushalt, damit gleichzeitige Beitritte die Obergrenze nicht überschreiten
    perform 1 from public.households where id = result.id for update;
    if (select count(*) from public.household_members where household_id = result.id) >= 50 then
        raise exception 'Dieser Haushalt hat bereits 50 Mitglieder';
    end if;

    insert into public.household_members (household_id, user_id) values (result.id, auth.uid());
    return result;
end;
$$;

-- Verlassen: eigene Pläne in diesem Haushalt werden wieder privat,
-- der letzte Austritt löscht den Haushalt
create function public.leave_household(target uuid)
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

    delete from public.household_members where household_id = target and user_id = auth.uid();

    if not exists (select 1 from public.household_members where household_id = target) then
        delete from public.households where id = target;
    end if;
end;
$$;

revoke execute on function public.create_household(text, text[]) from public, anon;
revoke execute on function public.leave_household(uuid) from public, anon;
grant execute on function public.create_household(text, text[]) to authenticated;
grant execute on function public.leave_household(uuid) to authenticated;
