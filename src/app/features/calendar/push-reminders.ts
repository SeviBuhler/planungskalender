import { Injectable } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { firstValueFrom } from 'rxjs';
import { Supabase } from '../../services/supabase';

// Push reminders of the app, switched on per device. The reminders are sent by the Edge Function
// supabase/functions/send-reminders; the service worker (ngsw) shows them.
export function deviceName(userAgent: string): string {
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/Android/.test(userAgent)) return 'Android';
  if (/Mac OS X/.test(userAgent)) return 'Mac';
  if (/Windows/.test(userAgent)) return 'Windows';
  return 'Gerät';
}

@Injectable({
  providedIn: 'root'
})
export class PushReminders {
  constructor(private swPush: SwPush, private supabase: Supabase) {}

  // Needs the service worker (not in development) and, on the iPhone, ForTwo on the home screen
  get supported(): boolean {
    return this.swPush.isEnabled && typeof Notification !== 'undefined';
  }

  get blocked(): boolean {
    return typeof Notification !== 'undefined' && Notification.permission === 'denied';
  }

  // On when this device has a push subscription that is stored for the current user
  async isOn(): Promise<boolean> {
    if (!this.supported) return false;
    const subscription = await firstValueFrom(this.swPush.subscription);
    if (!subscription) return false;
    const { data, error } = await this.supabase.client
      .from('push_subscriptions')
      .select('id')
      .eq('endpoint', subscription.endpoint)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  }

  async enable(): Promise<void> {
    const { data, error } = await this.supabase.client.functions.invoke('send-reminders', { body: { action: 'public-key' } });
    if (error) {
      // Show what the Edge Function (or the gateway, e.g. function not deployed) answered
      if (error instanceof FunctionsHttpError) {
        const status = (error.context as Response).status;
        const details = await (error.context as Response).json().catch(() => null);
        throw new Error(`Edge Function send-reminders (${status}): ${details?.error ?? details?.message ?? error.message}`);
      }
      throw error;
    }
    const subscription = await this.swPush.requestSubscription({ serverPublicKey: data.publicKey });
    const json = subscription.toJSON();
    const { error: saveError } = await this.supabase.client.rpc('save_push_subscription', {
      sub_endpoint: subscription.endpoint,
      sub_p256dh: json.keys?.['p256dh'],
      sub_auth: json.keys?.['auth'],
      sub_device_name: deviceName(navigator.userAgent),
    });
    if (saveError) throw saveError;
  }

  async disable(): Promise<void> {
    const subscription = await firstValueFrom(this.swPush.subscription);
    if (!subscription) return;
    const { error } = await this.supabase.client.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
    if (error) throw error;
    await this.swPush.unsubscribe();
  }
}
