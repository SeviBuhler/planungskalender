import { Injectable, inject } from '@angular/core';
import { PasskeyListItem } from '@supabase/supabase-js';
import { Supabase } from '../../services/supabase';

// Login with a passkey (fingerprint, Face ID or device code) instead of e-mail and password.
// Uses the passkeys of Supabase Auth (beta, switched on in the dashboard under Authentication > Passkeys).

// Remembers that this device has a passkey, so the login does not offer to set one up again
const HERE_KEY = 'fortwo.passkeyHere';

@Injectable({ providedIn: 'root' })
export class Passkeys {
  private readonly supabase = inject(Supabase);

  get registeredHere(): boolean {
    try { return !!localStorage.getItem(HERE_KEY); } catch { return false; }
  }

  async supported(): Promise<boolean> {
    try {
      return typeof PublicKeyCredential !== 'undefined' && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  async signIn(): Promise<void> {
    const { error } = await this.supabase.client.auth.signInWithPasskey();
    if (error) throw new Error(passkeyError(error));
    remember();
  }

  // Needs a login; the passkey gets the name of the device
  async register(): Promise<void> {
    const { data, error } = await this.supabase.client.auth.registerPasskey();
    if (error) throw new Error(passkeyError(error));
    remember();
    if (data?.id) await this.supabase.client.auth.passkey.update({ passkeyId: data.id, friendlyName: deviceName() });
  }

  async list(): Promise<PasskeyListItem[]> {
    const { data, error } = await this.supabase.client.auth.passkey.list();
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async remove(passkeyId: string): Promise<void> {
    const { error } = await this.supabase.client.auth.passkey.delete({ passkeyId });
    if (error) throw new Error(error.message);
    // Not known which passkey belongs to this device, so ask again after the next login
    forget();
  }
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Gerät';
}

function passkeyError(error: { message: string; name?: string }): string {
  if (error.name === 'NotAllowedError' || /not allowed|cancel|abort/i.test(error.message)) return 'Abgebrochen.';
  if (/disabled|not enabled/i.test(error.message)) return 'Passkeys sind in Supabase noch nicht eingeschaltet.';
  return error.message;
}

function remember() {
  try { localStorage.setItem(HERE_KEY, '1'); } catch { /* private mode */ }
}

function forget() {
  try { localStorage.removeItem(HERE_KEY); } catch { /* private mode */ }
}
