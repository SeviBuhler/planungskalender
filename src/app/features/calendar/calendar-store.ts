import { Injectable } from '@angular/core';
import { Supabase } from '../../services/supabase';
import { CalendarEvent, Category, Recurrence } from './calendar-layout';

export type EventInput = Omit<CalendarEvent, 'id' | 'ownerId'>;

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  owner_id: string;
  household_id: string | null;
  category: Category | null;
  series_id: string | null;
  recurrence: Recurrence | null;
  recurrence_until: string | null;
}

const COLUMNS =
  'id, title, description, starts_at, ends_at, all_day, owner_id, household_id, category, series_id, recurrence, recurrence_until';

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
    category: row.category,
    seriesId: row.series_id,
    recurrence: row.recurrence,
    recurrenceUntil: row.recurrence_until,
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
    category: input.category,
    series_id: input.seriesId,
    recurrence: input.recurrence,
    recurrence_until: input.recurrenceUntil,
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

  // Creates one event or all occurrences of a series in one request
  async create(inputs: EventInput[]): Promise<void> {
    const { error } = await this.supabase.client.from('calendar_events').insert(inputs.map(toRow));
    if (error) throw error;
  }

  async update(id: string, input: EventInput): Promise<void> {
    const { error } = await this.supabase.client.from('calendar_events').update(toRow(input)).eq('id', id);
    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('calendar_events').delete().eq('id', id);
    if (error) throw error;
  }

  // Deletes the occurrences of a series that start at or after `from`
  async deleteSeriesFrom(seriesId: string, from: Date): Promise<void> {
    const { error } = await this.supabase.client
      .from('calendar_events')
      .delete()
      .eq('series_id', seriesId)
      .gte('starts_at', from.toISOString());
    if (error) throw error;
  }
}
