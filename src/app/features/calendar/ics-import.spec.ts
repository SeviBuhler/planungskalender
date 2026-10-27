import { parseIcs, resolveZone, zonedToDate } from './ics-import';

const NOW = new Date(2026, 9, 27);

function ics(...events: string[][]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
}

describe('parseIcs', () => {
  it('reads a single event with folded and escaped text', () => {
    const text = ics([
      'UID:a1', 'DTSTART:20261103T080000Z', 'DTEND:20261103T093000Z',
      'SUMMARY:Zahnarzt\\, Kontrolle', 'DESCRIPTION:Zeile 1\\nZei', ' le 2', 'LOCATION:Bern',
      'BEGIN:VALARM', 'SUMMARY:Erinnerung', 'END:VALARM',
    ]);
    const [event] = parseIcs(text, NOW).events;
    expect(event.title).toBe('Zahnarzt, Kontrolle');
    expect(event.description).toBe('Zeile 1\nZeile 2\n\nOrt: Bern');
    expect(event.start.toISOString()).toBe('2026-11-03T08:00:00.000Z');
    expect(event.end.toISOString()).toBe('2026-11-03T09:30:00.000Z');
    expect(event.key).toBe('a1');
    expect(event.seriesKey).toBeNull();
  });

  it('converts times of a named zone, also Windows names from Outlook', () => {
    expect(resolveZone('W. Europe Standard Time')).toBe('Europe/Zurich');
    expect(resolveZone('/mozilla.org/20050126_1/Europe/Berlin')).toBe('Europe/Berlin');
    expect(resolveZone('Nirgendwo')).toBeNull();
    // Summer and winter time in Zurich
    expect(zonedToDate(Date.UTC(2026, 6, 1, 12), 'Europe/Zurich').toISOString()).toBe('2026-07-01T10:00:00.000Z');
    expect(zonedToDate(Date.UTC(2026, 11, 1, 12), 'Europe/Zurich').toISOString()).toBe('2026-12-01T11:00:00.000Z');
    const [event] = parseIcs(ics(['UID:z', 'DTSTART;TZID=America/New_York:20261110T090000', 'DURATION:PT2H', 'SUMMARY:Call']), NOW).events;
    expect(event.start.toISOString()).toBe('2026-11-10T14:00:00.000Z');
    expect(event.end.toISOString()).toBe('2026-11-10T16:00:00.000Z');
  });

  it('keeps all-day events as local days with exclusive end', () => {
    const [one, two] = parseIcs(ics(
      ['UID:d1', 'DTSTART;VALUE=DATE:20261224', 'DTEND;VALUE=DATE:20261227', 'SUMMARY:Weihnachten'],
      ['UID:d2', 'DTSTART;VALUE=DATE:20261231', 'SUMMARY:Silvester'],
    ), NOW).events;
    expect(one.allDay).toBe(true);
    expect(one.start).toEqual(new Date(2026, 11, 24));
    expect(one.end).toEqual(new Date(2026, 11, 27));
    expect(two.end).toEqual(new Date(2027, 0, 1));
  });

  it('expands a weekly series in its zone across daylight saving, with exceptions', () => {
    const { events } = parseIcs(ics(
      ['UID:s1', 'DTSTART;TZID=Europe/Zurich:20261019T180000', 'DTEND;TZID=Europe/Zurich:20261019T190000',
        'RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE;TZID=Europe/Zurich:20261102T180000', 'SUMMARY:Yoga'],
      ['UID:s1', 'RECURRENCE-ID;TZID=Europe/Zurich:20261026T180000', 'DTSTART;TZID=Europe/Zurich:20261027T190000',
        'DTEND;TZID=Europe/Zurich:20261027T200000', 'SUMMARY:Yoga (verschoben)'],
    ), NOW);
    expect(events.map((e) => [e.title, e.start.toISOString()])).toEqual([
      ['Yoga', '2026-10-19T16:00:00.000Z'],
      ['Yoga (verschoben)', '2026-10-27T18:00:00.000Z'],
      ['Yoga', '2026-11-09T17:00:00.000Z'], // winter time, still 18:00 in Zurich
    ]);
    expect(new Set(events.map((e) => e.seriesKey))).toEqual(new Set(['s1']));
    expect(events.every((e) => e.recurrence === 'weekly' && e.recurrenceUntil === '2026-11-09')).toBe(true);
    expect(events[1].key).toBe('s1|2026-10-26T17:00:00.000Z');
  });

  it('handles rules ForTwo cannot edit as series without own repeat option', () => {
    const { events } = parseIcs(ics([
      'UID:mw', 'DTSTART:20261102T070000Z', 'DTEND:20261102T080000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261111T235959Z', 'SUMMARY:Sport',
    ]), NOW);
    expect(events.map((e) => e.start.toISOString().slice(0, 10))).toEqual(['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11']);
    expect(events[0].recurrence).toBeNull();
    expect(events[0].seriesKey).toBe('mw');
  });

  it('expands monthly rules by weekday position and day of month', () => {
    const lastFriday = parseIcs(ics([
      'UID:lf', 'DTSTART;VALUE=DATE:20261030', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3', 'SUMMARY:Teamessen',
    ]), NOW).events;
    expect(lastFriday.map((e) => e.start)).toEqual([new Date(2026, 9, 30), new Date(2026, 10, 27), new Date(2026, 11, 25)]);
    const thirtyFirst = parseIcs(ics([
      'UID:31', 'DTSTART;VALUE=DATE:20270131', 'RRULE:FREQ=MONTHLY;COUNT=3', 'SUMMARY:Monatsende',
    ]), NOW).events;
    expect(thirtyFirst.map((e) => e.start)).toEqual([new Date(2027, 0, 31), new Date(2027, 2, 31), new Date(2027, 4, 31)]);
    expect(thirtyFirst[0].recurrence).toBe('monthly');
  });

  it('cuts endless series after the future window and drops old events', () => {
    const result = parseIcs(ics(
      ['UID:bd', 'DTSTART;VALUE=DATE:19900315', 'RRULE:FREQ=YEARLY', 'SUMMARY:Geburtstag'],
      ['UID:old', 'DTSTART:20100101T100000Z', 'SUMMARY:Alt'],
      ['UID:x', 'DTSTART:20261201T100000Z', 'STATUS:CANCELLED', 'SUMMARY:Abgesagt'],
    ), NOW);
    // 2022 (within 5 years back) to 2029 (3 years ahead)
    expect(result.events.map((e) => e.start.getFullYear())).toEqual([2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029]);
    expect(result.events[0].recurrence).toBe('yearly');
    expect(result.truncatedSeries).toBe(1);
    expect(result.skipped).toBe(1 + 1 + 32); // old event, cancelled, birthdays before 2022
  });

  it('reads floating times as local time and reports unknown zones', () => {
    const result = parseIcs(ics(['UID:f', 'DTSTART;TZID=Mars/Olympus:20261105T100000', 'SUMMARY:Irgendwo']), NOW);
    expect(result.events[0].start).toEqual(new Date(2026, 10, 5, 10));
    expect(result.unknownZones).toEqual(['Mars/Olympus']);
  });
});
