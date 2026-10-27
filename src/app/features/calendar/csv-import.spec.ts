import { CsvFormatError, parseCsv, parseCsvDate, parseCsvRows, parseCsvTime } from './csv-import';

const NOW = new Date(2026, 9, 27);

describe('parseCsv', () => {
  it('splits quoted fields with separators and line breaks', () => {
    expect(parseCsvRows('a;b\r\n"x;1";"Zeile\n2 ""zitiert"""\r\n')).toEqual([['a', 'b'], ['x;1', 'Zeile\n2 "zitiert"']]);
  });

  it('reads dates and times in common formats', () => {
    expect(parseCsvDate('27.10.2026')).toEqual({ y: 2026, m: 10, d: 27 });
    expect(parseCsvDate('10/27/2026')).toEqual({ y: 2026, m: 10, d: 27 });
    expect(parseCsvDate('27/10/26')).toEqual({ y: 2026, m: 10, d: 27 });
    expect(parseCsvDate('2026-10-27')).toEqual({ y: 2026, m: 10, d: 27 });
    expect(parseCsvTime('14:30:00')).toEqual({ h: 14, min: 30 });
    expect(parseCsvTime('2:30 PM')).toEqual({ h: 14, min: 30 });
    expect(parseCsvTime('12:15 AM')).toEqual({ h: 0, min: 15 });
  });

  it('reads a German Outlook export', () => {
    const text = [
      '"Betreff","Beginnt am","Beginnt um","Endet am","Endet um","Ganztägiges Ereignis","Beschreibung","Ort"',
      '"Arzt","3.11.2026","08:00:00","3.11.2026","09:00:00","Aus","Kontrolle","Bern"',
      '"Ferien","24.12.2026","00:00:00","27.12.2026","00:00:00","Ein","",""',
    ].join('\r\n');
    const { events } = parseCsv(text, NOW);
    expect(events[0]).toMatchObject({
      title: 'Arzt', start: new Date(2026, 10, 3, 8), end: new Date(2026, 10, 3, 9), allDay: false, description: 'Kontrolle\n\nOrt: Bern',
    });
    expect(events[1]).toMatchObject({ title: 'Ferien', start: new Date(2026, 11, 24), end: new Date(2026, 11, 27), allDay: true });
  });

  it('reads the Google CSV format', () => {
    const text = 'Subject,Start Date,Start Time,End Date,End Time,All Day Event\nParty,12/05/2026,7:00 PM,,,False\nAusflug,12/06/2026,,,,True';
    const { events } = parseCsv(text, NOW);
    expect(events[0].start).toEqual(new Date(2026, 11, 5, 19));
    expect(events[0].end).toEqual(new Date(2026, 11, 5, 20));
    expect(events[1]).toMatchObject({ allDay: true, start: new Date(2026, 11, 6), end: new Date(2026, 11, 7) });
  });

  it('explains missing columns', () => {
    expect(() => parseCsv('Name;Telefon\nAnna;123', NOW)).toThrow(CsvFormatError);
  });
});
