import { Injectable, inject } from '@angular/core';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Supabase } from '../../services/supabase';

// Device unlock (Face ID, fingerprint, device PIN) as second login step.
// The passkeys are checked by the Edge Function supabase/functions/device-unlock.

// Remembers on this device that it has a passkey, so the login offers the device unlock here
const DEVICE_KEY = 'fortwo.deviceCredential';

@Injectable({ providedIn: 'root' })
export class DeviceUnlock {
  private readonly supabase = inject(Supabase);

  get registeredHere(): boolean {
    try { return !!localStorage.getItem(DEVICE_KEY); } catch { return false; }
  }

  async available(): Promise<boolean> {
    try {
      return typeof PublicKeyCredential !== 'undefined' && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  // The devices of the current user (all domains)
  async devices(): Promise<DeviceInfo[]> {
    const { data, error } = await this.supabase.client
      .from('device_credentials')
      .select('id, credential_id, device_name, rp_id, created_at, last_used_at')
      .order('created_at');
    if (error) throw new Error(error.message);
    return (data ?? []).map((d) => ({
      id: d.id,
      name: d.device_name,
      domain: d.rp_id,
      createdAt: d.created_at,
      lastUsedAt: d.last_used_at,
      thisDevice: d.credential_id === localCredential(),
    }));
  }

  async remove(device: DeviceInfo): Promise<void> {
    const { error } = await this.supabase.client.from('device_credentials').delete().eq('id', device.id);
    if (error) throw new Error(error.message);
    if (device.thisDevice) forget();
  }

  // Needs a mail code from the last 15 minutes
  async register(deviceName: string): Promise<void> {
    // Loaded on demand so the login page stays small
    const { startRegistration, WebAuthnError } = await import('@simplewebauthn/browser');
    const options = await this.call('register-options');
    let response;
    try {
      response = await startRegistration({ optionsJSON: options as never });
    } catch (error) {
      // This device already has a passkey for the account, only the local note was lost
      if (error instanceof WebAuthnError && error.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
        remember('existing');
        return;
      }
      throw error;
    }
    const result = await this.call('register-verify', { response, deviceName }) as { credentialId: string };
    remember(result.credentialId);
  }

  // Needs the password from the last 15 minutes; marks the current login as confirmed
  async authenticate(): Promise<void> {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const options = await this.call('auth-options');
    const response = await startAuthentication({ optionsJSON: options as never });
    await this.call('auth-verify', { response });
  }

  private async call(action: string, body: object = {}): Promise<unknown> {
    const { data, error } = await this.supabase.client.functions.invoke('device-unlock', { body: { action, ...body } });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const details = await error.context.json().catch(() => null);
        throw new Error(details?.error ?? error.message);
      }
      throw new Error(error.message);
    }
    return data;
  }
}

export interface DeviceInfo {
  id: string;
  name: string;
  domain: string;
  createdAt: string;
  lastUsedAt: string | null;
  thisDevice: boolean;
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Gerät';
}

function localCredential(): string | null {
  try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
}

function forget() {
  try { localStorage.removeItem(DEVICE_KEY); } catch { /* private mode */ }
}

function remember(credentialId: string) {
  try { localStorage.setItem(DEVICE_KEY, credentialId); } catch { /* private mode */ }
}
