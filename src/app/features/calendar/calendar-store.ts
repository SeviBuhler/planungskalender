import { Injectable } from '@angular/core';
import { Supabase } from '../../services/supabase';
import { CalendarEvent, Category, Recurrence } from './calendar-layout';
import { ImportedEvent } from './ics-import';

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

const IMPORT_CHUNK = 500;

// Same text gives the same id, so a second import keeps the occurrences in one series
async function seriesUuid(text: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

  // Imported events carry a key from the file; importing the same file again updates them
  async importEvents(events: ImportedEvent[], householdId: string | null, onProgress?: (done: number) => void): Promise<void> {
    const owner = await this.userId();
    if (!owner) throw new Error('Nicht angemeldet');
    const seriesIds = new Map<string, string>();
    for (const key of new Set(events.map((e) => e.seriesKey).filter((k): k is string => k !== null))) {
      seriesIds.set(key, await seriesUuid(`${owner}|${key}`));
    }
    const rows = events.map((e) => ({
      ...toRow({
        title: e.title,
        description: e.description,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        householdId,
        category: null,
        seriesId: e.seriesKey ? seriesIds.get(e.seriesKey)! : null,
        recurrence: e.seriesKey ? e.recurrence : null,
        recurrenceUntil: e.seriesKey ? e.recurrenceUntil : null,
      }),
      import_key: e.key,
    }));
    for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
      const { error } = await this.supabase.client
        .from('calendar_events')
        .upsert(rows.slice(i, i + IMPORT_CHUNK), { onConflict: 'owner_id,import_key', defaultToNull: false });
      if (error) throw error;
      onProgress?.(Math.min(rows.length, i + IMPORT_CHUNK));
    }
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
