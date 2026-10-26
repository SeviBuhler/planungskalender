-- Gerätesperre (Face ID, Fingerabdruck, Geräte-PIN) als zweiter Anmeldeschritt.
-- Supabase unterstützt WebAuthn als MFA auf gehosteten Projekten noch nicht, deshalb prüft
-- die Edge Function "device-unlock" die Passkeys selbst und schreibt nur sie in diese Tabellen.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

-- Ein Passkey pro Gerät
create table public.device_credentials (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    rp_id text not null,                -- Domain, für die der Passkey gilt
    credential_id text not null unique, -- base64url
    public_key text not null,           -- base64url (COSE)
    counter bigint not null default 0,
    transports text[] not null default '{}',
    device_name text not null,
    created_at timestamptz not null default now(),
    last_used_at timestamptz
);

create index device_credentials_user_idx on public.device_credentials (user_id);

alter table public.device_credentials enable row level security;

-- Eigene Geräte sehen und entfernen; anlegen und ändern nur über die Edge Function
create policy "Eigene Geräte sehen" on public.device_credentials
    for select to authenticated using (user_id = auth.uid());

create policy "Eigene Geräte entfernen" on public.device_credentials
    for delete to authenticated using (user_id = auth.uid());

-- Offene WebAuthn-Challenge pro Benutzer (nur Edge Function)
create table public.webauthn_challenges (
    user_id uuid primary key references auth.users (id) on delete cascade,
    challenge text not null,
    created_at timestamptz not null default now()
);

alter table public.webauthn_challenges enable row level security;

-- Erfolgreiche Gerätesperre pro Anmeldung (Session). Die App gilt 7 Tage ab verified_at als angemeldet.
create table public.device_unlocks (
    session_id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    verified_at timestamptz not null default now()
);

alter table public.device_unlocks enable row level security;

-- Nur die Bestätigung der aktuellen Anmeldung ist sichtbar
create policy "Eigene Bestätigung sehen" on public.device_unlocks
    for select to authenticated
    using (user_id = auth.uid() and session_id = (auth.jwt() ->> 'session_id')::uuid);
