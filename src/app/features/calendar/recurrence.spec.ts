import { MAX_OCCURRENCES, occurrences } from './recurrence';

describe('occurrences', () => {
  it('repeats weekly up to and including the last day', () => {
    const list = occurrences(new Date(2026, 10, 2, 18), new Date(2026, 10, 2, 19), 'weekly', new Date(2026, 10, 30))!;
    expect(list.map((o) => o.start.getDate())).toEqual([2, 9, 16, 23, 30]);
    expect(list[4].end).toEqual(new Date(2026, 10, 30, 19));
  });

  it('keeps monthly events on the last day for short months', () => {
    const list = occurrences(new Date(2027, 0, 31, 9), new Date(2027, 0, 31, 10), 'monthly', new Date(2027, 3, 30))!;
    expect(list.map((o) => o.start)).toEqual([
      new Date(2027, 0, 31, 9), new Date(2027, 1, 28, 9), new Date(2027, 2, 31, 9), new Date(2027, 3, 30, 9),
    ]);
  });

  it('keeps the clock time across daylight saving and multi-day lengths', () => {
    const list = occurrences(new Date(2026, 9, 24, 22), new Date(2026, 9, 25, 2), 'weekly', new Date(2026, 9, 31))!;
    expect(list[1].start).toEqual(new Date(2026, 9, 31, 22));
    expect(list[1].end).toEqual(new Date(2026, 10, 1, 2));
  });

  it('repeats all-day events yearly', () => {
    const list = occurrences(new Date(2028, 1, 29), new Date(2028, 2, 1), 'yearly', new Date(2030, 11, 31))!;
    expect(list.map((o) => [o.start.getFullYear(), o.start.getMonth(), o.start.getDate()])).toEqual([
      [2028, 1, 29], [2029, 1, 28], [2030, 1, 28],
    ]);
  });

  it('refuses series with too many occurrences', () => {
    expect(occurrences(new Date(2026, 0, 1), new Date(2026, 0, 2), 'daily', new Date(2030, 0, 1))).toBeNull();
    expect(occurrences(new Date(2026, 0, 1), new Date(2026, 0, 2), 'daily', new Date(2026, 0, MAX_OCCURRENCES))!.length).toBe(MAX_OCCURRENCES);
  });
});
