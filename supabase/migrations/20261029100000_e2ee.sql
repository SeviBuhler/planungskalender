-- Ende-zu-Ende-Verschlüsselung: Inhalte (vorerst Titel und Beschreibung der Termine) werden
-- in der App verschlüsselt, bevor sie hierher kommen. Die Datenbank sieht nur noch Text wie
-- "e1:<scope>:<…>", auch im Dashboard. Die Schlüssel liegen hier nur verschlossen:
--   user_keys          öffentlicher Schlüssel + privater Schlüssel, verschlossen mit dem Wiederherstellungscode
--   encryption_scopes  ein Schlüsselbereich pro Haushalt (id = Haushalts-id) und ein persönlicher pro Person
--   scope_keys         der Schlüssel eines Bereichs, pro Mitglied mit dessen öffentlichem Schlüssel verschlossen
--   feed_keys          nur wer es in den Optionen einschaltet: Kalender-Schlüssel im Klartext, damit Abo-Link
--                      und Push-Erinnerungen Titel zeigen können (dann serverseitig lesbar)
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

create table public.user_keys (
    user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
    public_key text not null,
    wrapped_private_key text not null,
    personal_scope uuid not null,
    feed_titles boolean not null default false,
    created_at timestamptz not null default now()
);

-- Kein Fremdschlüssel auf households: Wird ein Haushalt gelöscht, müssen Termine, die beim
-- Verlassen privat wurden, noch mit seinem Schlüssel lesbar sein, bis die App sie neu verschlüsselt.
create table public.encryption_scopes (
    id uuid primary key,
    household_id uuid, -- null = persönlich
    created_by uuid references auth.users (id) on delete cascade default auth.uid(),
    created_at timestamptz not null default now(),
    check (household_id is null or household_id = id)
);

create table public.scope_keys (
    scope_id uuid not null references public.encryption_scopes (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    sealed_key text not null,
    created_by uuid references auth.users (id) on delete set null default auth.uid(),
    created_at timestamptz not null default now(),
    primary key (scope_id, user_id)
);

create table public.feed_keys (
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    scope_id uuid not null,
    calendar_key text not null,
    primary key (user_id, scope_id)
);

alter table public.user_keys enable row level security;
alter table public.encryption_scopes enable row level security;
alter table public.scope_keys enable row level security;
alter table public.feed_keys enable row level security;

-- Öffentliche Schlüssel sehen nur Personen, die einen Haushalt teilen
create function public.shares_household(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.household_members a
        join public.household_members b on b.household_id = a.household_id
        where a.user_id = auth.uid() and b.user_id = other
    );
$$;

-- Wer den Schlüssel eines Haushalts hat, darf ihn für ein anderes Mitglied verschliessen
create function public.may_store_scope_key(scope uuid, target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.encryption_scopes s
        where s.id = scope
          and s.household_id is not null
          and exists (select 1 from public.scope_keys k where k.scope_id = s.id and k.user_id = auth.uid())
          and exists (select 1 from public.household_members m where m.household_id = s.household_id and m.user_id = auth.uid())
          and exists (select 1 from public.household_members m where m.household_id = s.household_id and m.user_id = target)
    );
$$;

-- Legt einen Bereich zusammen mit dem eigenen Schlüssel an (beides oder nichts).
-- Gibt false zurück, wenn ein anderes Mitglied den Haushaltsbereich schon angelegt hat.
create function public.create_encryption_scope(scope uuid, household uuid, sealed text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'Nicht angemeldet';
    end if;
    if household is not null and (household <> scope or not public.is_household_member(household)) then
        raise exception 'Kein Mitglied dieses Haushalts';
    end if;

    insert into public.encryption_scopes (id, household_id, created_by)
    values (scope, household, auth.uid())
    on conflict (id) do nothing;
    if not found then
        return false;
    end if;

    insert into public.scope_keys (scope_id, user_id, sealed_key) values (scope, auth.uid(), sealed);
    return true;
end;
$$;

create policy "Schlüssel sehen" on public.user_keys
    for select to authenticated using (user_id = auth.uid() or public.shares_household(user_id));
create policy "Eigene Schlüssel anlegen" on public.user_keys
    for insert to authenticated with check (user_id = auth.uid());
create policy "Eigene Schlüssel ändern" on public.user_keys
    for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke update on public.user_keys from anon, authenticated;
grant update (public_key, wrapped_private_key, personal_scope, feed_titles) on public.user_keys to authenticated;

create policy "Bereiche sehen" on public.encryption_scopes
    for select to authenticated
    using (created_by = auth.uid() or (household_id is not null and public.is_household_member(household_id)));

create policy "Eigene Bereichsschlüssel sehen" on public.scope_keys
    for select to authenticated using (user_id = auth.uid());
create policy "Bereichsschlüssel ablegen" on public.scope_keys
    for insert to authenticated with check (public.may_store_scope_key(scope_id, user_id));
create policy "Eigene Bereichsschlüssel löschen" on public.scope_keys
    for delete to authenticated using (user_id = auth.uid());

create policy "Eigene Abo-Schlüssel" on public.feed_keys
    for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Mitglieder meiner Haushalte, die schon Schlüssel haben, aber den Haushaltsschlüssel noch nicht
-- (neu beigetreten oder auf einem neuen Gerät neu angefangen). Die App verschliesst ihn dann für sie.
create function public.missing_scope_keys()
returns table (scope_id uuid, user_id uuid, public_key text)
language sql
stable
security definer
set search_path = ''
as $$
    select s.id, m.user_id, u.public_key
    from public.scope_keys mine
    join public.encryption_scopes s on s.id = mine.scope_id and s.household_id is not null
    join public.household_members me on me.household_id = s.household_id and me.user_id = auth.uid()
    join public.household_members m on m.household_id = s.household_id and m.user_id <> auth.uid()
    join public.user_keys u on u.user_id = m.user_id
    where mine.user_id = auth.uid()
      and not exists (select 1 from public.scope_keys k where k.scope_id = s.id and k.user_id = m.user_id);
$$;

-- Bestehende Klartext-Termine einmalig verschlüsseln (mehrere auf einmal; RLS gilt wie beim Bearbeiten)
create function public.set_calendar_texts(items jsonb)
returns integer
language sql
security invoker
set search_path = ''
as $$
    with changed as (
        update public.calendar_events e
        set title = i.title, description = i.description
        from jsonb_to_recordset(items) as i (id uuid, title text, description text)
        where e.id = i.id
        returning 1
    )
    select count(*)::integer from changed;
$$;

revoke execute on function public.shares_household(uuid) from public, anon;
revoke execute on function public.may_store_scope_key(uuid, uuid) from public, anon;
revoke execute on function public.create_encryption_scope(uuid, uuid, text) from public, anon;
revoke execute on function public.missing_scope_keys() from public, anon;
revoke execute on function public.set_calendar_texts(jsonb) from public, anon;
grant execute on function public.shares_household(uuid) to authenticated;
grant execute on function public.may_store_scope_key(uuid, uuid) to authenticated;
grant execute on function public.create_encryption_scope(uuid, uuid, text) to authenticated;
grant execute on function public.missing_scope_keys() to authenticated;
grant execute on function public.set_calendar_texts(jsonb) to authenticated;
