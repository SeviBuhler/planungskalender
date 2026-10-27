// Reads calendar CSV exports (Outlook, Google's import format), with English or German column names
import { ImportResult, ImportedEvent } from './ics-import';

const COLUMNS = {
  title: ['subject', 'betreff', 'titel', 'title', 'summary', 'name'],
  startDate: ['start date', 'beginnt am', 'startdatum', 'beginn', 'start', 'datum', 'date'],
  startTime: ['start time', 'beginnt um', 'startzeit', 'uhrzeit', 'time'],
  endDate: ['end date', 'endet am', 'enddatum', 'ende', 'end'],
  endTime: ['end time', 'endet um', 'endzeit'],
  allDay: ['all day event', 'all day', 'all-day', 'ganztägiges ereignis', 'ganztägig', 'ganztags'],
  description: ['description', 'beschreibung', 'notizen', 'notes'],
  location: ['location', 'ort', 'standort'],
};

type Column = keyof typeof COLUMNS;

export class CsvFormatError extends Error {}

export function parseCsvRows(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0];
  const separator = [';', '\t', ','].reduce((best, s) => (firstLine.split(s).length > firstLine.split(best).length ? s : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

// 2026-10-27, 27.10.2026, 10/27/2026 (US, as Google and English Outlook write it) or 27/10/2026
export function parseCsvDate(value: string): { y: number; m: number; d: number } | null {
  const v = value.trim();
  let match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return { y: +match[1], m: +match[2], d: +match[3] };
  match = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (match) return { y: fullYear(+match[3]), m: +match[2], d: +match[1] };
  match = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (match) {
    const [a, b] = [+match[1], +match[2]];
    return a > 12 ? { y: fullYear(+match[3]), m: b, d: a } : { y: fullYear(+match[3]), m: a, d: b };
  }
  return null;
}

const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

// 14:30, 14:30:00, 2:30 PM
export function parseCsvTime(value: string): { h: number; min: number } | null {
  const match = value.trim().match(/(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([AaPp])?\.?[Mm]?\.?$/);
  if (!match) return null;
  let h = +match[1];
  const pm = match[3]?.toLowerCase() === 'p';
  if (match[3]) h = (h % 12) + (pm ? 12 : 0);
  return h < 24 && +match[2] < 60 ? { h, min: +match[2] } : null;
}

const truthy = (value: string) => ['true', 'wahr', 'ja', 'yes', '1', 'x', 'ein'].includes(value.trim().toLowerCase());

export function parseCsv(text: string, now = new Date()): ImportResult {
  const [header, ...rows] = parseCsvRows(text);
  if (!header) throw new CsvFormatError('Die Datei ist leer.');
  const names = header.map((h) => h.trim().toLowerCase());
  const index = {} as Record<Column, number>;
  for (const column of Object.keys(COLUMNS) as Column[]) {
    index[column] = COLUMNS[column].map((alias) => names.indexOf(alias)).find((i) => i >= 0) ?? -1;
  }
  if (index.title < 0 || index.startDate < 0) {
    throw new CsvFormatError('Spalten nicht erkannt. Nötig sind mindestens „Betreff“/„Subject“ und „Beginnt am“/„Start Date“.');
  }

  const oldest = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
  const events: ImportedEvent[] = [];
  let skipped = 0;
  for (const row of rows) {
    const cell = (column: Column) => (index[column] >= 0 ? (row[index[column]] ?? '').trim() : '');
    const startDate = parseCsvDate(cell('startDate'));
    if (!startDate) {
      skipped++;
      continue;
    }
    // The time may also sit in the date column ("2026-10-27 09:00")
    const startTime = parseCsvTime(cell('startTime')) ?? (cell('startDate').match(/[\sT]\d/) ? parseCsvTime(cell('startDate')) : null);
    const endDate = parseCsvDate(cell('endDate')) ?? startDate;
    const endTime = parseCsvTime(cell('endTime')) ?? (cell('endDate').match(/[\sT]\d/) ? parseCsvTime(cell('endDate')) : null);
    const allDay = truthy(cell('allDay')) || !startTime;

    let start: Date;
    let end: Date;
    if (allDay) {
      start = new Date(startDate.y, startDate.m - 1, startDate.d);
      end = new Date(endDate.y, endDate.m - 1, endDate.d + 1);
      // Outlook writes the day after as end of all-day events
      if (cell('endDate') && endTime && endTime.h === 0 && endTime.min === 0) end = new Date(endDate.y, endDate.m - 1, endDate.d);
      if (end <= start) end = new Date(startDate.y, startDate.m - 1, startDate.d + 1);
    } else {
      start = new Date(startDate.y, startDate.m - 1, startDate.d, startTime!.h, startTime!.min);
      end = endTime
        ? new Date(endDate.y, endDate.m - 1, endDate.d, endTime.h, endTime.min)
        : new Date(start.getTime() + 60 * 60 * 1000);
      if (end < start) end = new Date(start.getTime() + 60 * 60 * 1000);
    }
    if (end < oldest) {
      skipped++;
      continue;
    }

    const title = cell('title') || 'Ohne Titel';
    const location = cell('location');
    const description = [cell('description'), location && `Ort: ${location}`].filter(Boolean).join('\n\n');
    events.push({
      key: `csv|${title}|${start.toISOString()}`,
      title: title.slice(0, 500),
      description: description ? description.slice(0, 5000) : null,
      start,
      end,
      allDay,
      seriesKey: null,
      recurrence: null,
      recurrenceUntil: null,
    });
  }
  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { events, skipped, truncatedSeries: 0, unknownZones: [] };
}
