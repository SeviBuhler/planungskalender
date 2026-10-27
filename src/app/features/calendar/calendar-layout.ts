// Pure date and layout helpers for the calendar views (all in local time)

export type CalendarView = 'year' | 'month' | 'week' | 'day';
export type Category = 'work' | 'private' | 'family' | 'health' | 'leisure' | 'other';
export type Recurrence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  start: Date;
  end: Date; // exclusive; for all-day events the start of the day after the last day
  allDay: boolean;
  ownerId: string;
  householdId: string | null;
  category: Category | null;
  seriesId: string | null; // occurrences of one repeating event share this id
  recurrence: Recurrence | null;
  recurrenceUntil: string | null; // last day of the series, YYYY-MM-DD
  reminderMinutes: number | null; // remind this many minutes before the start; null = no reminder
}

export interface CalendarDay {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
}

export interface PositionedEvent {
  event: CalendarEvent;
  top: number; // percent of the day
  height: number; // percent of the day
  left: number; // percent of the width
  width: number; // percent of the width
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
}

// Monday of the week the date lies in
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

// ISO 8601 week number (weeks start on Monday, week 1 holds the first Thursday)
export function isoWeek(date: Date): number {
  const thursday = addDays(startOfWeek(date), 3);
  const firstThursday = addDays(startOfWeek(new Date(thursday.getFullYear(), 0, 4)), 3);
  return Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS)) + 1;
}

// The days the week view shows: Monday to Sunday, or on small screens a few days starting at the date
export function buildWeek(date: Date, length = 7, today: Date = new Date()): CalendarDay[] {
  const first = length === 7 ? startOfWeek(date) : startOfDay(date);
  return Array.from({ length }, (_, i) => {
    const day = addDays(first, i);
    return { date: day, inMonth: true, isToday: isSameDay(day, today) };
  });
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Moves the shown date by one year, month, week (of weekLength days) or day;
// months keep the day where possible (31 Jan -> 28 Feb)
export function shiftDate(date: Date, view: CalendarView, direction: 1 | -1, weekLength = 7): Date {
  if (view === 'day') return addDays(date, direction);
  if (view === 'week') return addDays(date, weekLength * direction);
  const months = view === 'year' ? 12 * direction : direction;
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
}

// The time range a view shows, used to load its events
export function visibleRange(date: Date, view: CalendarView, weekLength = 7): { from: Date; to: Date } {
  if (view === 'day') return { from: startOfDay(date), to: addDays(startOfDay(date), 1) };
  if (view === 'week') {
    const days = buildWeek(date, weekLength);
    return { from: days[0].date, to: addDays(days[days.length - 1].date, 1) };
  }
  if (view === 'year') return { from: new Date(date.getFullYear(), 0, 1), to: new Date(date.getFullYear() + 1, 0, 1) };
  const grid = buildMonthGrid(date.getFullYear(), date.getMonth());
  return { from: grid[0].date, to: addDays(grid[grid.length - 1].date, 1) };
}

// Builds the visible grid for a month: full weeks from Monday to Sunday
export function buildMonthGrid(year: number, month: number, today: Date = new Date()): CalendarDay[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((offset + daysInMonth) / 7) * 7;

  const days: CalendarDay[] = [];
  for (let i = 0; i < cellCount; i++) {
    const date = new Date(year, month, 1 - offset + i);
    days.push({ date, inMonth: date.getMonth() === month, isToday: isSameDay(date, today) });
  }
  return days;
}

function overlapsDay(event: CalendarEvent, dayStart: Date, dayEnd: Date): boolean {
  if (event.start.getTime() === event.end.getTime()) {
    return event.start >= dayStart && event.start < dayEnd;
  }
  return event.start < dayEnd && event.end > dayStart;
}

// Events touching a day: all-day events first, then by start time
export function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  return events
    .filter((e) => overlapsDay(e, dayStart, dayEnd))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
}

// Places the timed events of a day on a 24h column; events that overlap share the width side by side
export function layoutDay(events: CalendarEvent[], day: Date): PositionedEvent[] {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + DAY_MS;
  const timed = eventsOnDay(events, day)
    .filter((e) => !e.allDay)
    .map((event) => ({
      event,
      start: Math.max(event.start.getTime(), dayStart),
      end: Math.min(Math.max(event.end.getTime(), event.start.getTime() + 15 * 60 * 1000), dayEnd),
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const result: PositionedEvent[] = [];
  let cluster: { item: (typeof timed)[number]; column: number }[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const columns = columnEnds.length;
    for (const { item, column } of cluster) {
      result.push({
        event: item.event,
        top: ((item.start - dayStart) / DAY_MS) * 100,
        height: ((item.end - item.start) / DAY_MS) * 100,
        left: (column / columns) * 100,
        width: 100 / columns,
      });
    }
    cluster = [];
    columnEnds = [];
  };

  for (const item of timed) {
    if (item.start >= clusterEnd) flush();
    let column = columnEnds.findIndex((end) => end <= item.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.end);
    } else {
      columnEnds[column] = item.end;
    }
    cluster.push({ item, column });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return result;
}
