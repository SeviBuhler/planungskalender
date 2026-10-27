// Reads iCalendar files (.ics) exported by Google, Apple/iCloud, Outlook and others.
// Repeating events (RRULE) are expanded into single occurrences, like series created in ForTwo.
import { Recurrence } from './calendar-layout';
import { MAX_OCCURRENCES } from './recurrence';

export interface ImportedEvent {
  key: string; // stable per source event and occurrence, a second import updates instead of duplicating
  title: string;
  description: string | null;
  start: Date;
  end: Date; // exclusive; for all-day events the start of the day after the last day
  allDay: boolean;
  seriesKey: string | null; // occurrences of one repeating event share this key
  recurrence: Recurrence | null; // null for rules ForTwo cannot edit (e.g. every Monday and Wednesday)
  recurrenceUntil: string | null; // last day of the series, YYYY-MM-DD
}

export interface ImportResult {
  events: ImportedEvent[];
  skipped: number; // cancelled, without start or ended more than 5 years ago
  truncatedSeries: number; // endless or very long series cut after FUTURE_YEARS or MAX_OCCURRENCES
  unknownZones: string[]; // read as local time
}

// Same window as the subscription feed and the 5-year clean-up
export const FUTURE_YEARS = 3;
const PAST_YEARS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---- Lines and properties ----

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function splitOutsideQuotes(text: string, separator: string, limit = Infinity): string[] {
  const parts: string[] = [];
  let quoted = false;
  let current = '';
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (char === separator && !quoted && parts.length < limit - 1) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function parseLine(line: string): Prop | null {
  const [head, value] = splitOutsideQuotes(line, ':', 2);
  if (value === undefined) return null;
  const [name, ...rawParams] = splitOutsideQuotes(head, ';');
  const params: Record<string, string> = {};
  for (const param of rawParams) {
    const index = param.indexOf('=');
    if (index > 0) params[param.slice(0, index).toUpperCase()] = param.slice(index + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) => (char === 'n' || char === 'N' ? '\n' : char));
}

// VEVENT properties; nested parts such as VALARM are left out
function readEvents(text: string): Prop[][] {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: Prop[][] = [];
  let current: Prop[] | null = null;
  let nested = 0;
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    const value = prop.value.trim().toUpperCase();
    if (prop.name === 'BEGIN') {
      if (current) nested++;
      else if (value === 'VEVENT') current = [];
    } else if (prop.name === 'END') {
      if (current && nested > 0) nested--;
      else if (current && value === 'VEVENT') {
        events.push(current);
        current = null;
      }
    } else if (current && nested === 0) {
      current.push(prop);
    }
  }
  return events;
}

// ---- Dates and time zones ----

// Wall-clock times are handled as "naive" milliseconds: Date.UTC of the date and time as written
interface Stamp {
  naive: number;
  allDay: boolean;
  utc: boolean;
  zone: string | null; // IANA zone, null = local time of the device
}

// Outlook writes Windows zone names
const WINDOWS_ZONES: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Zurich',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Helsinki',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(zone, f);
  }
  return f;
}

function isZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

export function resolveZone(tzid: string): string | null {
  const name = tzid.trim();
  if (WINDOWS_ZONES[name]) return WINDOWS_ZONES[name];
  if (isZone(name)) return name;
  // e.g. "/mozilla.org/20050126_1/Europe/Berlin" or "(UTC+01:00) Amsterdam, Berlin"
  const tail = name.match(/([A-Za-z_]+\/[A-Za-z_+-]+)$/)?.[1];
  if (tail && isZone(tail)) return tail;
  return null;
}

// Wall time in the zone minus UTC
function zoneOffset(instant: number, zone: string): number {
  const parts = formatter(zone).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return wall - Math.floor(instant / 1000) * 1000;
}

export function zonedToDate(naive: number, zone: string): Date {
  const first = zoneOffset(naive, zone);
  const instant = naive - first;
  const second = zoneOffset(instant, zone);
  return new Date(second === first ? instant : naive - second);
}

function naiveParts(naive: number) {
  const d = new Date(naive);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()] as const;
}

function toDate(naive: number, stamp: Pick<Stamp, 'allDay' | 'utc' | 'zone'>): Date {
  const [y, m, d, h, min, s] = naiveParts(naive);
  if (stamp.allDay) return new Date(y, m, d);
  if (stamp.utc) return new Date(naive);
  if (stamp.zone) return zonedToDate(naive, stamp.zone);
  return new Date(y, m, d, h, min, s);
}

function dayOf(naive: number): number {
  return Math.floor(naive / DAY_MS) * DAY_MS;
}

function parseStamp(value: string, params: Record<string, string>, unknownZones: Set<string>): Stamp | null {
  const match = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i);
  if (!match) return null;
  const [, y, m, d, h, min, s, z] = match;
  const allDay = params['VALUE']?.toUpperCase() === 'DATE' || h === undefined;
  const naive = Date.UTC(+y, +m - 1, +d, allDay ? 0 : +h, allDay ? 0 : +min, allDay ? 0 : +(s ?? 0));
  let zone: string | null = null;
  if (!allDay && !z && params['TZID']) {
    zone = resolveZone(params['TZID']);
    if (!zone) unknownZones.add(params['TZID']);
  }
  return { naive, allDay, utc: !allDay && !!z, zone };
}

// e.g. P1D, PT1H30M, -PT15M, P2W
function parseDuration(value: string): number | null {
  const match = value.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!match) return null;
  const [, sign, w, d, h, min, s] = match;
  const ms = ((+(w ?? 0) * 7 + +(d ?? 0)) * 24 * 3600 + +(h ?? 0) * 3600 + +(min ?? 0) * 60 + +(s ?? 0)) * 1000;
  return sign === '-' ? -ms : ms;
}

// ---- Repeat rules ----

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  until: Stamp | null;
  byDay: { weekday: number; nth: number }[]; // nth 0 = every, 2 = second, -1 = last
  byMonthDay: number[];
  byMonth: number[]; // 1-12
  bySetPos: number[];
}

function parseRule(value: string, unknownZones: Set<string>): Rule | null {
  const parts: Record<string, string> = {};
  for (const part of value.split(';')) {
    const [key, val] = part.split('=');
    if (key && val !== undefined) parts[key.trim().toUpperCase()] = val.trim().toUpperCase();
  }
  const freq = parts['FREQ'];
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  // Rare parts that would change which days are meant
  if (['BYYEARDAY', 'BYWEEKNO', 'BYHOUR', 'BYMINUTE', 'BYSECOND'].some((key) => key in parts)) return null;
  const numbers = (key: string) => (parts[key] ? parts[key].split(',').map(Number).filter((n) => Number.isInteger(n) && n !== 0) : []);
  const byDay: Rule['byDay'] = [];
  for (const day of parts['BYDAY']?.split(',') ?? []) {
    const match = day.match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/);
    if (match) byDay.push({ weekday: WEEKDAY_CODES.indexOf(match[2]), nth: match[1] ? Number(match[1]) : 0 });
  }
  return {
    freq,
    interval: Math.max(1, Number(parts['INTERVAL']) || 1),
    count: parts['COUNT'] ? Math.max(1, Number(parts['COUNT']) || 1) : null,
    until: parts['UNTIL'] ? parseStamp(parts['UNTIL'], {}, unknownZones) : null,
    byDay,
    byMonthDay: numbers('BYMONTHDAY'),
    byMonth: numbers('BYMONTH'),
    bySetPos: numbers('BYSETPOS'),
  };
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // m 0-11
const weekday = (day: number) => new Date(day).getUTCDay();

// Is `day` one of the BYDAY entries, with "nth" counted inside the given span of days?
function matchesByDay(day: number, rule: Rule, spanStart: number, spanEnd: number): boolean {
  return rule.byDay.some((b) => {
    if (b.weekday !== weekday(day)) return false;
    if (b.nth === 0) return true;
    const fromStart = Math.floor((day - spanStart) / DAY_MS / 7) + 1;
    const fromEnd = -(Math.floor((spanEnd - day) / DAY_MS / 7) + 1);
    return b.nth === fromStart || b.nth === fromEnd;
  });
}

function daysOfMonth(y: number, m: number, rule: Rule, startDay: number): number[] {
  const count = daysInMonth(y, m);
  let days: number[];
  if (rule.byMonthDay.length) days = rule.byMonthDay.map((d) => (d < 0 ? count + 1 + d : d)).filter((d) => d >= 1 && d <= count);
  else if (rule.byDay.length) days = Array.from({ length: count }, (_, i) => i + 1);
  else days = startDay <= count ? [startDay] : []; // like the RFC: 31st skips shorter months
  const first = Date.UTC(y, m, 1);
  const last = Date.UTC(y, m, count);
  return [...new Set(days)]
    .sort((a, b) => a - b)
    .map((d) => Date.UTC(y, m, d))
    .filter((day) => !rule.byDay.length || matchesByDay(day, rule, first, last));
}

// The start of the n-th period and its candidate days (00:00 naive)
function period(rule: Rule, start: number, n: number): { begin: number; days: number[] } {
  const [y, m, d] = naiveParts(start);
  const inMonths = (day: number) => !rule.byMonth.length || rule.byMonth.includes(new Date(day).getUTCMonth() + 1);
  switch (rule.freq) {
    case 'DAILY': {
      const day = dayOf(start) + n * rule.interval * DAY_MS;
      const [, dm, dd] = naiveParts(day);
      const ok = inMonths(day)
        && (!rule.byMonthDay.length || rule.byMonthDay.some((x) => x === dd || x === dd - daysInMonth(new Date(day).getUTCFullYear(), dm) - 1))
        && (!rule.byDay.length || rule.byDay.some((b) => b.weekday === weekday(day)));
      return { begin: day, days: ok ? [day] : [] };
    }
    case 'WEEKLY': {
      // Weeks start on Monday
      const begin = dayOf(start) - ((weekday(start) + 6) % 7) * DAY_MS + n * rule.interval * 7 * DAY_MS;
      const all = Array.from({ length: 7 }, (_, i) => begin + i * DAY_MS);
      const days = rule.byDay.length
        ? all.filter((day) => rule.byDay.some((b) => b.weekday === weekday(day)))
        : all.filter((day) => weekday(day) === weekday(start));
      return { begin, days: days.filter(inMonths) };
    }
    case 'MONTHLY': {
      const begin = Date.UTC(y, m + n * rule.interval, 1);
      const [by, bm] = naiveParts(begin);
      return { begin, days: inMonths(begin) ? daysOfMonth(by, bm, rule, d) : [] };
    }
    case 'YEARLY': {
      const year = y + n * rule.interval;
      const begin = Date.UTC(year, 0, 1);
      if (rule.byMonth.length) {
        return { begin, days: [...rule.byMonth].sort((a, b) => a - b).flatMap((month) => daysOfMonth(year, month - 1, rule, d)) };
      }
      if (rule.byMonthDay.length) {
        return { begin, days: Array.from({ length: 12 }, (_, month) => daysOfMonth(year, month, rule, d)).flat() };
      }
      if (rule.byDay.length) {
        // e.g. every Monday of the year, or the 20th Monday
        const end = Date.UTC(year, 11, 31);
        const days: number[] = [];
        for (let day = begin; day <= end; day += DAY_MS) if (matchesByDay(day, rule, begin, end)) days.push(day);
        return { begin, days };
      }
      const day = Date.UTC(year, m, d);
      return { begin, days: new Date(day).getUTCMonth() === m ? [day] : [] }; // 29 Feb skips other years
    }
  }
}

function applySetPos(days: number[], positions: number[]): number[] {
  if (!positions.length) return days;
  const picked = positions.map((p) => days[p > 0 ? p - 1 : days.length + p]).filter((d) => d !== undefined);
  return [...new Set(picked)].sort((a, b) => a - b);
}

// Starts (naive) of all occurrences up to `horizon`; `truncated` when the rule goes on beyond it
function expand(rule: Rule, start: Stamp, horizon: number): { starts: number[]; truncated: boolean } {
  const time = start.naive - dayOf(start.naive);
  const starts = [start.naive]; // the first date always counts, even if it does not match the rule
  const isPastUntil = (naive: number) => {
    const until = rule.until;
    if (!until) return false;
    if (until.allDay || start.allDay) return dayOf(naive) > dayOf(until.naive);
    return toDate(naive, start).getTime() > toDate(until.naive, until).getTime();
  };
  for (let n = 0; n < 100000; n++) {
    const { begin, days } = period(rule, start.naive, n);
    if (begin > horizon) {
      const finished = isPastUntil(begin) || (rule.count !== null && starts.length >= rule.count);
      return { starts, truncated: !finished };
    }
    for (const day of applySetPos(days, rule.bySetPos)) {
      const naive = day + time;
      if (naive <= start.naive) continue;
      if (isPastUntil(naive) || (rule.count !== null && starts.length >= rule.count)) return { starts, truncated: false };
      if (naive > horizon) return { starts, truncated: true };
      if (starts.length >= MAX_OCCURRENCES) return { starts, truncated: true };
      starts.push(naive);
    }
  }
  return { starts, truncated: true };
}

// The rule as one of ForTwo's own repeat options, if it is that simple
function simpleRecurrence(rule: Rule, start: Stamp): Recurrence | null {
  const [, m, d] = naiveParts(start.naive);
  if (rule.bySetPos.length) return null;
  const onlyStartWeekday = rule.byDay.every((b) => b.nth === 0 && b.weekday === weekday(start.naive));
  const onlyStartDay = rule.byMonthDay.every((x) => x === d);
  const onlyStartMonth = rule.byMonth.every((x) => x === m + 1);
  switch (rule.freq) {
    case 'DAILY':
      return rule.interval === 1 && !rule.byDay.length && !rule.byMonthDay.length && !rule.byMonth.length ? 'daily' : null;
    case 'WEEKLY':
      if (!onlyStartWeekday || rule.byMonthDay.length || rule.byMonth.length) return null;
      return rule.interval === 1 ? 'weekly' : rule.interval === 2 ? 'biweekly' : null;
    case 'MONTHLY':
      return rule.interval === 1 && !rule.byDay.length && onlyStartDay && !rule.byMonth.length ? 'monthly' : null;
    case 'YEARLY':
      return rule.interval === 1 && !rule.byDay.length && onlyStartDay && onlyStartMonth ? 'yearly' : null;
  }
}

// ---- Events ----

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const occurrenceKey = (date: Date, allDay: boolean) => (allDay ? dateKey(date) : date.toISOString());

function textOf(props: Prop[], name: string): string {
  return unescapeText(props.find((p) => p.name === name)?.value ?? '').trim();
}

function stampsOf(props: Prop[], name: string, unknownZones: Set<string>): Stamp[] {
  return props
    .filter((p) => p.name === name)
    .flatMap((p) => p.value.split(',').map((v) => parseStamp(v, p.params, unknownZones)))
    .filter((s): s is Stamp => s !== null);
}

interface Source {
  props: Prop[];
  uid: string;
  start: Stamp;
  length: number; // ms; whole days for all-day events
}

function sourceOf(props: Prop[], unknownZones: Set<string>): Source | null {
  const startProp = props.find((p) => p.name === 'DTSTART');
  const start = startProp && parseStamp(startProp.value, startProp.params, unknownZones);
  if (!start) return null;
  const endProp = props.find((p) => p.name === 'DTEND');
  const end = endProp && parseStamp(endProp.value, endProp.params, unknownZones);
  const duration = parseDuration(props.find((p) => p.name === 'DURATION')?.value ?? '');
  let length: number;
  if (start.allDay) {
    length = end ? dayOf(end.naive) - start.naive : duration !== null ? Math.ceil(duration / DAY_MS) * DAY_MS : DAY_MS;
    length = Math.max(DAY_MS, length);
  } else {
    length = end ? toDate(end.naive, end).getTime() - toDate(start.naive, start).getTime() : duration ?? 0;
    length = Math.max(0, length);
  }
  const summary = textOf(props, 'SUMMARY');
  const uid = textOf(props, 'UID') || `${summary}|${startProp!.value}`;
  return { props, uid, start, length };
}

function buildEvent(source: Source, naiveStart: number, key: string): Omit<ImportedEvent, 'seriesKey' | 'recurrence' | 'recurrenceUntil'> {
  const { props, start: stamp, length } = source;
  const start = toDate(naiveStart, stamp);
  const end = stamp.allDay ? toDate(naiveStart + length, stamp) : new Date(start.getTime() + length);
  const location = textOf(props, 'LOCATION');
  const description = [textOf(props, 'DESCRIPTION'), location && `Ort: ${location}`].filter(Boolean).join('\n\n');
  return {
    key,
    title: (textOf(props, 'SUMMARY') || 'Ohne Titel').slice(0, 500),
    description: description ? description.slice(0, 5000) : null,
    start,
    end,
    allDay: stamp.allDay,
  };
}

const isCancelled = (props: Prop[]) => textOf(props, 'STATUS').toUpperCase() === 'CANCELLED';

export function parseIcs(text: string, now = new Date()): ImportResult {
  const unknownZones = new Set<string>();
  const oldest = new Date(now.getFullYear() - PAST_YEARS, now.getMonth(), now.getDate());
  const horizonDate = new Date(now.getFullYear() + FUTURE_YEARS, now.getMonth(), now.getDate());
  const horizon = Date.UTC(horizonDate.getFullYear(), horizonDate.getMonth(), horizonDate.getDate());
  let skipped = 0;
  let truncatedSeries = 0;

  const masters: Source[] = [];
  const overrides = new Map<string, { source: Source; recurrenceId: Stamp }[]>();
  for (const props of readEvents(text)) {
    const source = sourceOf(props, unknownZones);
    if (!source) {
      skipped++;
      continue;
    }
    const recurrenceId = stampsOf(props, 'RECURRENCE-ID', unknownZones)[0];
    if (recurrenceId) {
      overrides.set(source.uid, [...(overrides.get(source.uid) ?? []), { source, recurrenceId }]);
    } else {
      masters.push(source);
    }
  }

  const events: ImportedEvent[] = [];
  const keep = (event: ImportedEvent) => {
    if (event.end < oldest) skipped++;
    else events.push(event);
  };

  for (const master of masters) {
    if (isCancelled(master.props)) {
      skipped++;
      continue;
    }
    const ruleProp = master.props.find((p) => p.name === 'RRULE');
    const rule = ruleProp ? parseRule(ruleProp.value, unknownZones) : null;
    const rdates = stampsOf(master.props, 'RDATE', unknownZones);
    const changed = overrides.get(master.uid) ?? [];
    overrides.delete(master.uid);
    if (!rule && !rdates.length) {
      keep({ ...buildEvent(master, master.start.naive, master.uid), seriesKey: null, recurrence: null, recurrenceUntil: null });
      continue;
    }

    const expanded = rule ? expand(rule, master.start, horizon) : { starts: [master.start.naive], truncated: false };
    if (expanded.truncated) truncatedSeries++;
    // EXDATE and RECURRENCE-ID name an occurrence by its original start
    const keyOf = (stamp: Stamp) => {
      if (master.start.allDay || stamp.allDay) return dateKey(toDate(dayOf(stamp.naive), { allDay: true, utc: false, zone: null }));
      const floating = !stamp.utc && !stamp.zone;
      return toDate(stamp.naive, floating ? master.start : stamp).toISOString();
    };
    const excluded = new Set(stampsOf(master.props, 'EXDATE', unknownZones).map(keyOf));
    const replaced = new Map(changed.map((c) => [keyOf(c.recurrenceId), c.source]));
    const starts = [...new Set([...expanded.starts, ...rdates.filter((r) => r.naive <= horizon).map((r) => r.naive)])].sort((a, b) => a - b);

    const series: ImportedEvent[] = [];
    const add = (source: Source, naive: number, key: string) =>
      series.push({ ...buildEvent(source, naive, `${master.uid}|${key}`), seriesKey: master.uid, recurrence: null, recurrenceUntil: null });
    for (const naive of starts) {
      const date = toDate(naive, master.start);
      const key = occurrenceKey(date, master.start.allDay);
      if (excluded.has(key) || excluded.has(dateKey(date))) continue;
      const override = replaced.get(key);
      replaced.delete(key);
      if (!override) add(master, naive, key);
      else if (!isCancelled(override.props)) add(override, override.start.naive, key);
    }
    // Changed occurrences the rule does not reach (e.g. beyond FUTURE_YEARS) stay in the series
    for (const [key, override] of replaced) {
      if (!isCancelled(override.props)) add(override, override.start.naive, key);
    }
    if (!series.length) {
      skipped++;
      continue;
    }
    const recurrence = rule && !rdates.length ? simpleRecurrence(rule, master.start) : null;
    const lastStart = series.reduce((last, e) => (e.start > last ? e.start : last), series[0].start);
    const recurrenceUntil = series.length > 1 ? dateKey(lastStart) : null;
    for (const event of series) {
      // A single remaining occurrence is a plain event
      keep(recurrenceUntil
        ? { ...event, recurrence, recurrenceUntil }
        : { ...event, seriesKey: null });
    }
  }

  // Changed occurrences whose series is not in the file
  for (const list of overrides.values()) {
    for (const { source, recurrenceId } of list) {
      if (isCancelled(source.props)) {
        skipped++;
        continue;
      }
      const key = `${source.uid}|${occurrenceKey(toDate(recurrenceId.naive, recurrenceId), recurrenceId.allDay)}`;
      keep({ ...buildEvent(source, source.start.naive, key), seriesKey: null, recurrence: null, recurrenceUntil: null });
    }
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { events, skipped, truncatedSeries, unknownZones: [...unknownZones] };
}
