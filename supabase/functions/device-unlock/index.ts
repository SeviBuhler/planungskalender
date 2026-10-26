// Gerätesperre (Face ID, Fingerabdruck, Geräte-PIN) als zweiter Anmeldeschritt für ForTwo.
// Supabase unterstützt WebAuthn-MFA auf gehosteten Projekten noch nicht, deshalb prüft diese
// Function die Passkeys selbst. Tabellen: supabase/migrations/20261026220000_device_unlock.sql
//
// Aktionen (POST, JSON-Body { action, ... }, mit dem Access Token des Benutzers):
//   register-options / register-verify  Gerät einrichten, nur kurz nach einem Mail-Code
//   auth-options / auth-verify           Anmeldung bestätigen, nur kurz nach dem Passwort

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from 'npm:@simplewebauthn/server@14.0.3';
import { isoBase64URL } from 'npm:@simplewebauthn/server@14.0.3/helpers';

// How long after the password / mail code the device step may follow (same as the app)
const STEP_SECONDS = 15 * 60;
const CHALLENGE_SECONDS = 5 * 60;

// Origins that may use the device unlock: WEBAUTHN_ORIGINS (comma separated, e.g. a custom domain),
// the app's Vercel deployments and local development
const EXTRA_ORIGINS = (Deno.env.get('WEBAUTHN_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const ORIGIN_PATTERNS = [/^https:\/\/fortwo[a-z0-9-]*\.vercel\.app$/, /^http:\/\/localhost:\d+$/];

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return EXTRA_ORIGINS.includes(origin) || ORIGIN_PATTERNS.some((p) => p.test(origin)) ? origin : null;
}

function reply(origin: string | null, status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin ?? '',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
    },
  });
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Claims {
  sub: string;
  session_id: string;
  email?: string;
  amr?: { method: string; timestamp: number }[];
}

// Validates the token with Supabase, then reads its claims
async function currentUser(req: Request): Promise<Claims> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!token) throw new HttpError(401, 'Nicht angemeldet.');
  const { error } = await admin.auth.getUser(token);
  if (error) throw new HttpError(401, 'Nicht angemeldet.');
  const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(payload)) as Claims;
}

function requireRecent(claims: Claims, method: string, message: string) {
  const now = Date.now() / 1000;
  const ok = (claims.amr ?? []).some((m) => m.method === method && now - m.timestamp < STEP_SECONDS);
  if (!ok) throw new HttpError(403, message);
}

async function saveChallenge(userId: string, challenge: string) {
  const { error } = await admin.from('webauthn_challenges').upsert({ user_id: userId, challenge, created_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

// Each challenge can be used once
async function takeChallenge(userId: string): Promise<string> {
  const { data } = await admin.from('webauthn_challenges').delete().eq('user_id', userId).select().maybeSingle();
  if (!data || Date.now() - new Date(data.created_at).getTime() > CHALLENGE_SECONDS * 1000) {
    throw new HttpError(400, 'Die Anfrage ist abgelaufen. Bitte nochmals versuchen.');
  }
  return data.challenge;
}

async function credentialsFor(userId: string, rpID: string) {
  const { data, error } = await admin.from('device_credentials').select('*').eq('user_id', userId).eq('rp_id', rpID);
  if (error) throw new Error(error.message);
  return data;
}

async function handle(req: Request, origin: string): Promise<unknown> {
  const rpID = new URL(origin).hostname;
  const claims = await currentUser(req);
  const body = await req.json();

  switch (body.action) {
    case 'register-options': {
      requireRecent(claims, 'otp', 'Bitte zuerst mit dem E-Mail-Code bestätigen.');
      const existing = await credentialsFor(claims.sub, rpID);
      const options = await generateRegistrationOptions({
        rpName: 'ForTwo',
        rpID,
        userName: claims.email ?? claims.sub,
        userID: new TextEncoder().encode(claims.sub),
        attestationType: 'none',
        excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports })),
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        preferredAuthenticatorType: 'localDevice',
      });
      await saveChallenge(claims.sub, options.challenge);
      return options;
    }

    case 'register-verify': {
      requireRecent(claims, 'otp', 'Bitte zuerst mit dem E-Mail-Code bestätigen.');
      const verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: await takeChallenge(claims.sub),
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!verification.verified) throw new HttpError(400, 'Das Gerät konnte nicht bestätigt werden.');
      const { credential } = verification.registrationInfo;
      const { error } = await admin.from('device_credentials').insert({
        user_id: claims.sub,
        rp_id: rpID,
        credential_id: credential.id,
        public_key: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        device_name: String(body.deviceName ?? 'Gerät').slice(0, 100),
      });
      if (error) throw new Error(error.message);
      return { credentialId: credential.id };
    }

    case 'auth-options': {
      requireRecent(claims, 'password', 'Bitte zuerst mit dem Passwort anmelden.');
      const existing = await credentialsFor(claims.sub, rpID);
      if (existing.length === 0) throw new HttpError(404, 'Auf diesem Konto ist keine Gerätesperre eingerichtet.');
      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports })),
        userVerification: 'required',
      });
      await saveChallenge(claims.sub, options.challenge);
      return options;
    }

    case 'auth-verify': {
      requireRecent(claims, 'password', 'Bitte zuerst mit dem Passwort anmelden.');
      const stored = (await credentialsFor(claims.sub, rpID)).find((c) => c.credential_id === body.response?.id);
      if (!stored) throw new HttpError(404, 'Dieses Gerät ist nicht eingerichtet.');
      const verification = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: await takeChallenge(claims.sub),
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: stored.credential_id,
          publicKey: isoBase64URL.toBuffer(stored.public_key),
          counter: Number(stored.counter),
          transports: stored.transports,
        },
        requireUserVerification: true,
      });
      if (!verification.verified) throw new HttpError(400, 'Die Gerätesperre konnte nicht bestätigt werden.');
      const now = new Date().toISOString();
      await admin.from('device_credentials')
        .update({ counter: verification.authenticationInfo.newCounter, last_used_at: now })
        .eq('id', stored.id);
      const { error } = await admin.from('device_unlocks')
        .upsert({ session_id: claims.session_id, user_id: claims.sub, verified_at: now });
      if (error) throw new Error(error.message);
      return { verifiedAt: now };
    }

    default:
      throw new HttpError(400, 'Unbekannte Aktion.');
  }
}

Deno.serve(async (req) => {
  const origin = allowedOrigin(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return reply(origin, 204, null);
  if (!origin) return reply(null, 403, { error: 'Diese Seite darf die Gerätesperre nicht verwenden.' });
  try {
    return reply(origin, 200, await handle(req, origin));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return reply(origin, status, { error: error instanceof Error ? error.message : String(error) });
  }
});
