import { Injectable } from '@angular/core';
import { Supabase } from '../../services/supabase';
import { Vault } from '../crypto/vault';
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
  reminder_minutes: number | null;
  birth_year: number | null;
  event_participants?: { user_id: string }[];
}

const COLUMNS =
  'id, title, description, starts_at, ends_at, all_day, owner_id, household_id, category, series_id, recurrence, recurrence_until, reminder_minutes, birth_year, event_participants(user_id)';

const LOCKED_TITLE = '🔒 Verschlüsselt';
const MIGRATE_PAGE = 1000;
const MIGRATE_CHUNK = 200;

// Title and description are encrypted with the key of the household (or the personal key)
async function toEvent(row: EventRow, vault: Vault): Promise<CalendarEvent> {
  const title = await vault.decrypt('calendar', row.title);
  const description = row.description === null ? null : await vault.decrypt('calendar', row.description);
  return {
    id: row.id,
    title: title ?? LOCKED_TITLE,
    description: title === null ? null : description,
    locked: title === null,
    start: new Date(row.starts_at),
    end: new Date(row.ends_at),
    allDay: row.all_day,
    ownerId: row.owner_id,
    householdId: row.household_id,
    category: row.category,
    seriesId: row.series_id,
    recurrence: row.recurrence,
    recurrenceUntil: row.recurrence_until,
    reminderMinutes: row.reminder_minutes,
    birthYear: row.birth_year,
    participants: (row.event_participants ?? []).map((p) => p.user_id),
  };
}

const IMPORT_CHUNK = 500;
const PARTICIPANT_CHUNK = 500;

// Same text gives the same id, so a second import keeps the occurrences in one series
async function seriesUuid(text: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function toRow(input: EventInput, vault: Vault) {
  const scope = input.householdId ?? vault.personalScope();
  return {
    title: await vault.encrypt('calendar', scope, input.title),
    description: input.description === null ? null : await vault.encrypt('calendar', scope, input.description),
    starts_at: input.start.toISOString(),
    ends_at: input.end.toISOString(),
    all_day: input.allDay,
    household_id: input.householdId,
    category: input.category,
    series_id: input.seriesId,
    recurrence: input.recurrence,
    recurrence_until: input.recurrenceUntil,
    reminder_minutes: input.reminderMinutes,
    birth_year: input.birthYear,
  };
}

// Events live in Supabase; RLS returns private events and those of the user's households
@Injectable({
  providedIn: 'root'
})
export class CalendarStore {
  private migration: Promise<void> | null = null;

  constructor(private supabase: Supabase, private vault: Vault) {}

  async userId(): Promise<string | null> {
    const { data } = await this.supabase.client.auth.getSession();
    return data.session?.user.id ?? null;
  }

  async listRange(from: Date, to: Date): Promise<CalendarEvent[]> {
    await this.vault.ready();
    this.migration ??= this.encryptExisting().catch((error) => console.error('Termine verschlüsseln fehlgeschlagen', error));
    const { data, error } = await this.supabase.client
      .from('calendar_events')
      .select(COLUMNS)
      .lt('starts_at', to.toISOString())
      .gte('ends_at', from.toISOString())
      .order('starts_at');
    if (error) throw error;
    return Promise.all((data as EventRow[]).map((row) => toEvent(row, this.vault)));
  }

  // Creates one event or all occurrences of a series in one request. The creator is entered as
  // participant by the database, the other chosen participants are added here.
  async create(inputs: EventInput[]): Promise<void> {
    await this.vault.ready();
    const rows = await Promise.all(inputs.map((input) => toRow(input, this.vault)));
    const { data, error } = await this.supabase.client.from('calendar_events').insert(rows).select('id, owner_id');
    if (error) throw error;
    const extra = (data as { id: string; owner_id: string }[]).flatMap((row, i) =>
      [...new Set(inputs[i].participants ?? [])].filter((user) => user !== row.owner_id).map((user) => ({ event_id: row.id, user_id: user }))
    );
    for (let i = 0; i < extra.length; i += PARTICIPANT_CHUNK) {
      const { error: participantError } = await this.supabase.client.from('event_participants').insert(extra.slice(i, i + PARTICIPANT_CHUNK));
      if (participantError) throw participantError;
    }
  }

  // Imported events carry a key from the file; importing the same file again updates them
  async importEvents(events: ImportedEvent[], householdId: string | null, onProgress?: (done: number) => void): Promise<void> {
    const owner = await this.userId();
    if (!owner) throw new Error('Nicht angemeldet');
    await this.vault.ready();
    const seriesIds = new Map<string, string>();
    for (const key of new Set(events.map((e) => e.seriesKey).filter((k): k is string => k !== null))) {
      seriesIds.set(key, await seriesUuid(`${owner}|${key}`));
    }
    // Reminders and birth years are left out, so importing the file again keeps the ones set in ForTwo
    const rows = await Promise.all(events.map(async (e) => {
      const { reminder_minutes, birth_year, ...row } = await toRow({
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
        reminderMinutes: null,
        birthYear: null,
      }, this.vault);
      return { ...row, import_key: e.key };
    }));
    for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
      const { error } = await this.supabase.client
        .from('calendar_events')
        .upsert(rows.slice(i, i + IMPORT_CHUNK), { onConflict: 'owner_id,import_key', defaultToNull: false });
      if (error) throw error;
      onProgress?.(Math.min(rows.length, i + IMPORT_CHUNK));
    }
  }

  // Participants are only passed (and changed) when the creator saves the event
  async update(id: string, input: EventInput): Promise<void> {
    await this.vault.ready();
    const { error } = await this.supabase.client.from('calendar_events').update(await toRow(input, this.vault)).eq('id', id);
    if (error) throw error;
    if (input.participants) await this.setParticipants(id, input.participants);
  }

  // Only the creator may do this (RLS); the creator stays a participant in any case
  private async setParticipants(eventId: string, participants: string[]): Promise<void> {
    const owner = await this.userId();
    if (!owner) throw new Error('Nicht angemeldet');
    const keep = [...new Set([owner, ...participants])];
    const { error } = await this.supabase.client
      .from('event_participants')
      .delete()
      .eq('event_id', eventId)
      .not('user_id', 'in', `(${keep.join(',')})`);
    if (error) throw error;
    const add = keep.filter((user) => user !== owner).map((user) => ({ event_id: eventId, user_id: user }));
    if (!add.length) return;
    const { error: addError } = await this.supabase.client
      .from('event_participants')
      .upsert(add, { onConflict: 'event_id,user_id', ignoreDuplicates: true });
    if (addError) throw addError;
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

  // Events saved before encryption (or that moved between household and private) are encrypted
  // again with the key they belong to. Runs once per app start, in the background.
  private async encryptExisting(): Promise<void> {
    const owner = await this.userId();
    if (!owner) return;
    const { data: memberships, error } = await this.supabase.client.from('household_members').select('household_id').eq('user_id', owner);
    if (error) throw error;
    const scopes: { scope: string; household: string | null }[] = [
      { scope: this.vault.personalScope(), household: null },
      ...(memberships ?? []).map((m) => ({ scope: m.household_id as string, household: m.household_id as string })),
    ];
    for (const { scope, household } of scopes.filter((s) => this.vault.hasScope(s.scope))) {
      let lastId = '00000000-0000-0000-0000-000000000000';
      for (;;) {
        let query = this.supabase.client
          .from('calendar_events')
          .select('id, title, description')
          .not('title', 'like', `e1:${scope}:%`)
          .gt('id', lastId)
          .order('id')
          .limit(MIGRATE_PAGE);
        query = household ? query.eq('household_id', household) : query.is('household_id', null).eq('owner_id', owner);
        const { data, error: listError } = await query;
        if (listError) throw listError;
        const rows = data as { id: string; title: string; description: string | null }[];
        if (!rows.length) break;
        lastId = rows[rows.length - 1].id;

        const items = [];
        for (const row of rows) {
          const title = await this.vault.decrypt('calendar', row.title);
          const description = row.description === null ? null : await this.vault.decrypt('calendar', row.description);
          if (title === null || (row.description !== null && description === null)) continue; // key missing
          items.push({
            id: row.id,
            title: await this.vault.encrypt('calendar', scope, title),
            description: description === null ? null : await this.vault.encrypt('calendar', scope, description),
          });
        }
        for (let i = 0; i < items.length; i += MIGRATE_CHUNK) {
          const { error: saveError } = await this.supabase.client.rpc('set_calendar_texts', { items: items.slice(i, i + MIGRATE_CHUNK) });
          if (saveError) throw saveError;
        }
        if (rows.length < MIGRATE_PAGE) break;
      }
    }
  }
}
