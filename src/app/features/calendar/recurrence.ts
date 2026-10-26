// Categories and repeating events. A series is stored as one row per occurrence.
import { Category, Recurrence, startOfDay } from './calendar-layout';

export const CATEGORIES: { id: Category; label: string; tile: string }[] = [
  { id: 'work', label: 'Arbeit', tile: 'bg-blue-200 text-blue-950' },
  { id: 'private', label: 'Privat', tile: 'bg-emerald-200 text-emerald-950' },
  { id: 'family', label: 'Familie', tile: 'bg-amber-200 text-amber-950' },
  { id: 'health', label: 'Gesundheit', tile: 'bg-rose-200 text-rose-950' },
  { id: 'leisure', label: 'Freizeit', tile: 'bg-violet-200 text-violet-950' },
  { id: 'other', label: 'Sonstiges', tile: 'bg-gray-300 text-gray-900' },
];
export const DEFAULT_TILE = 'bg-indigo-100 text-indigo-900';

export const RECURRENCES: { id: Recurrence; label: string; defaultMonths: number }[] = [
  { id: 'daily', label: 'Täglich', defaultMonths: 3 },
  { id: 'weekly', label: 'Wöchentlich', defaultMonths: 12 },
  { id: 'biweekly', label: 'Alle 2 Wochen', defaultMonths: 12 },
  { id: 'monthly', label: 'Monatlich', defaultMonths: 12 },
  { id: 'yearly', label: 'Jährlich', defaultMonths: 60 },
];

export const MAX_OCCURRENCES = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

function nthStart(start: Date, recurrence: Recurrence, n: number): Date {
  const [y, m, d, h, min] = [start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()];
  switch (recurrence) {
    case 'daily':
      return new Date(y, m, d + n, h, min);
    case 'weekly':
      return new Date(y, m, d + 7 * n, h, min);
    case 'biweekly':
      return new Date(y, m, d + 14 * n, h, min);
    case 'monthly':
    case 'yearly': {
      // Always count from the first date so 31 Jan -> 28 Feb -> 31 Mar
      const months = recurrence === 'monthly' ? n : 12 * n;
      const lastDay = new Date(y, m + months + 1, 0).getDate();
      return new Date(y, m + months, Math.min(d, lastDay), h, min);
    }
  }
}

// All occurrences from start up to and including the day `until`.
// Returns null when the series would exceed MAX_OCCURRENCES.
export function occurrences(start: Date, end: Date, recurrence: Recurrence, until: Date): { start: Date; end: Date }[] | null {
  // Keep the end as "n days later at the same clock time" so DST does not shift it
  const dayOffset = Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / DAY_MS);
  const lastDay = startOfDay(until);
  const result: { start: Date; end: Date }[] = [];
  for (let n = 0; ; n++) {
    const s = nthStart(start, recurrence, n);
    if (startOfDay(s) > lastDay) return result;
    if (result.length === MAX_OCCURRENCES) return null;
    result.push({ start: s, end: new Date(s.getFullYear(), s.getMonth(), s.getDate() + dayOffset, end.getHours(), end.getMinutes()) });
  }
}
