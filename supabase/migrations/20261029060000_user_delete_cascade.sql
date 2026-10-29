-- Benutzer im Supabase-Dashboard (Authentication > Users) löschen scheiterte mit
-- "Database error deleting user": mindestens ein Fremdschlüssel auf auth.users
-- (z. B. profiles aus der Zeit vor den Migrationen) hat kein ON DELETE.
-- Dieses Skript sucht alle solchen Fremdschlüssel ausserhalb der Supabase-eigenen
-- Schemas und setzt sie neu: Spalten, die leer sein dürfen, werden beim Löschen
-- auf null gesetzt, alle anderen Zeilen werden mitgelöscht.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

do $$
declare
    fk record;
    nullable boolean;
    action text;
    def text;
begin
    for fk in
        select c.oid, c.conname, c.conrelid, c.conkey, c.conrelid::regclass as tbl
        from pg_constraint c
        join pg_namespace n on n.oid = c.connamespace
        where c.contype = 'f'
          and c.confrelid = 'auth.users'::regclass
          and c.confdeltype in ('a', 'r') -- no action / restrict
          and n.nspname not in ('auth', 'storage', 'realtime', 'supabase_functions', 'vault', 'extensions')
    loop
        select bool_and(not a.attnotnull) into nullable
        from pg_attribute a
        where a.attrelid = fk.conrelid and a.attnum = any (fk.conkey);
        action := case when nullable then 'set null' else 'cascade' end;

        def := regexp_replace(pg_get_constraintdef(fk.oid), '\s+ON DELETE (NO ACTION|RESTRICT)', '');
        -- ON DELETE gehört vor DEFERRABLE / NOT VALID
        if def ~ '\s(NOT DEFERRABLE|DEFERRABLE|NOT VALID)' then
            def := regexp_replace(def, '\s(NOT DEFERRABLE|DEFERRABLE|NOT VALID)', ' ON DELETE ' || action || ' \1');
        else
            def := def || ' ON DELETE ' || action;
        end if;

        raise notice '% (%): %', fk.tbl, fk.conname, def;
        execute format('alter table %s drop constraint %I', fk.tbl, fk.conname);
        execute format('alter table %s add constraint %I %s', fk.tbl, fk.conname, def);
    end loop;
end
$$;
