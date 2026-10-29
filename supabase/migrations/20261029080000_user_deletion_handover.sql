-- Wird ein Konto gelöscht, sollen geteilte Sachen nicht für die anderen Mitglieder
-- verschwinden: Haushalts-Termine, -Finanzpläne und -Einkaufslisten der gelöschten
-- Person gehen an das am längsten dabei seiende andere Mitglied über.
-- Haushalte, in denen danach niemand mehr ist, werden gelöscht.
-- Alles Private wird weiterhin über die Fremdschlüssel mitgelöscht (20261029060000).
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

create or replace function public.handover_on_user_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.calendar_events e set owner_id = h.heir
    from (
        select m.household_id, (array_agg(m.user_id order by m.joined_at))[1] as heir
        from public.household_members m
        where m.user_id <> old.id
        group by m.household_id
    ) h
    where e.owner_id = old.id and e.household_id = h.household_id;

    update public.finance_plans p set owner_id = h.heir
    from (
        select m.household_id, (array_agg(m.user_id order by m.joined_at))[1] as heir
        from public.household_members m
        where m.user_id <> old.id
        group by m.household_id
    ) h
    where p.owner_id = old.id and p.household_id = h.household_id;

    update public.shopping_lists l set owner_id = h.heir
    from (
        select m.household_id, (array_agg(m.user_id order by m.joined_at))[1] as heir
        from public.household_members m
        where m.user_id <> old.id
        group by m.household_id
    ) h
    where l.owner_id = old.id and l.household_id = h.household_id;

    delete from public.households hh
    where exists (select 1 from public.household_members m where m.household_id = hh.id and m.user_id = old.id)
      and not exists (select 1 from public.household_members m where m.household_id = hh.id and m.user_id <> old.id);

    return old;
end;
$$;

revoke all on function public.handover_on_user_delete() from public, anon, authenticated;

drop trigger if exists handover_on_user_delete on auth.users;
create trigger handover_on_user_delete
    before delete on auth.users
    for each row execute function public.handover_on_user_delete();
