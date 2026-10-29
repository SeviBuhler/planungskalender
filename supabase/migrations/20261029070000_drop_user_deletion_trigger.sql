-- Die alte Funktion handle_user_deletion() (Trigger auf auth.users aus der Zeit vor
-- den Haushalten) liest noch group_members, das 20261026180000_drop_groups.sql
-- entfernt hat. Dadurch scheiterte jedes Löschen eines Benutzers. Aufräumen
-- übernehmen jetzt die Fremdschlüssel mit ON DELETE (20261029060000).
-- cascade entfernt auch den Trigger, der die Funktion aufruft.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

drop function if exists public.handle_user_deletion() cascade;
