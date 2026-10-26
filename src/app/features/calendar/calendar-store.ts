import { Injectable } from '@angular/core';
import { Supabase } from '../../services/supabase';
import { CalendarEvent } from './calendar-layout';

export type EventInput = Pick<CalendarEvent, 'title' | 'description' | 'start' | 'end' | 'allDay' | 'householdId'>;

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  owner_id: string;
  household_id: string | null;
}

const COLUMNS = 'id, title, description, starts_at, ends_at, all_day, owner_id, household_id';

function toEvent(row: EventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    start: new Date(row.starts_at),
    end: new Date(row.ends_at),
    allDay: row.all_day,
    ownerId: row.owner_id,
    householdId: row.household_id,
  };
}

function toRow(input: EventInput) {
  return {
    title: input.title,
    description: input.description,
    starts_at: input.start.toISOString(),
    ends_at: input.end.toISOString(),
    all_day: input.allDay,
    household_id: input.householdId,
  };
}

// Events live in Supabase; RLS returns private events and those of the user's households
@Injectable({
  providedIn: 'root'
})
export class CalendarStore {
  constructor(private supabase: Supabase) {}

  async userId(): Promise<string | null> {
    const { data } = await this.supabase.client.auth.getSession();
    return data.session?.user.id ?? null;
  }

  async listRange(from: Date, to: Date): Promise<CalendarEvent[]> {
    const { data, error } = await this.supabase.client
      .from('calendar_events')
      .select(COLUMNS)
      .lt('starts_at', to.toISOString())
      .gte('ends_at', from.toISOString())
      .order('starts_at');
    if (error) throw error;
    return (data as EventRow[]).map(toEvent);
  }

  async create(input: EventInput): Promise<CalendarEvent> {
    const { data, error } = await this.supabase.client.from('calendar_events').insert(toRow(input)).select(COLUMNS).single();
    if (error) throw error;
    return toEvent(data as EventRow);
  }

  async update(id: string, input: EventInput): Promise<void> {
    const { error } = await this.supabase.client.from('calendar_events').update(toRow(input)).eq('id', id);
    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('calendar_events').delete().eq('id', id);
    if (error) throw error;
  }
}
