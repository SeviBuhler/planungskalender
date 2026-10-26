import { Injectable } from '@angular/core';
import { Supabase } from '../../services/supabase';
import { environment } from '../../../environments/environments';

// Secret subscription link that phone calendars (iPhone, Google, Outlook) read the events from.
// The link is served by the Edge Function supabase/functions/calendar-feed.
export function feedUrl(token: string): string {
  return `${environment.supabaseUrl}/functions/v1/calendar-feed?token=${token}`;
}

// webcal:// opens the subscribe dialog of the phone's calendar app directly
export function webcalUrl(token: string): string {
  return feedUrl(token).replace(/^https?:/, 'webcal:');
}

@Injectable({
  providedIn: 'root'
})
export class CalendarFeedStore {
  constructor(private supabase: Supabase) {}

  async token(): Promise<string | null> {
    const { data, error } = await this.supabase.client.from('calendar_feeds').select('token').maybeSingle();
    if (error) throw error;
    return data?.token ?? null;
  }

  // Creates the link, or replaces it so the old one stops working
  async renew(): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('renew_calendar_feed');
    if (error) throw error;
    return data as string;
  }

  async remove(): Promise<void> {
    const { data } = await this.supabase.client.auth.getSession();
    const { error } = await this.supabase.client.from('calendar_feeds').delete().eq('user_id', data.session?.user.id ?? '');
    if (error) throw error;
  }
}
