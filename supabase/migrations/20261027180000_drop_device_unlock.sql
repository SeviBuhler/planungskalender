-- The own device unlock (Edge Function device-unlock) is replaced by the passkeys of Supabase Auth.
drop table if exists public.device_unlocks;
drop table if exists public.webauthn_challenges;
drop table if exists public.device_credentials;
