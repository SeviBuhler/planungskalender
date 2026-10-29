import { CalendarEvent, buildMonthGrid, buildWeek, eventsOnDay, isoWeek, layoutDay, shiftDate, visibleRange } from './calendar-layout';

function event(id: string, start: Date, end: Date, allDay = false): CalendarEvent {
  return { id, title: id, description: null, start, end, allDay, ownerId: 'a', householdId: null, category: null, seriesId: null, recurrence: null, recurrenceUntil: null, reminderMinutes: null, birthYear: null };
}

const at = (hour: number, minute = 0, day = 3) => new Date(2026, 10, day, hour, minute);

describe('buildMonthGrid', () => {
  it('starts on Monday and covers full weeks', () => {
    // October 2026 starts on a Thursday and has 31 days
    const days = buildMonthGrid(2026, 9, new Date(2026, 9, 25));
    expect(days.length).toBe(35);
    expect(days[0].date.getDay()).toBe(1);
    expect(days[3].date.getDate()).toBe(1);
    expect(days.filter((d) => d.inMonth).length).toBe(31);
    expect(days.filter((d) => d.isToday).map((d) => d.date.getDate())).toEqual([25]);
  });
});

describe('buildWeek', () => {
  it('runs from Monday to Sunday of the given date', () => {
    const days = buildWeek(new Date(2026, 9, 29), 7, new Date(2026, 9, 27));
    expect(days.map((d) => d.date)).toEqual(Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 26 + i)));
    expect(days.filter((d) => d.isToday).map((d) => d.date.getDate())).toEqual([27]);
  });

  it('starts at the date itself for a shorter week', () => {
    expect(buildWeek(new Date(2026, 9, 29), 3).map((d) => d.date)).toEqual([new Date(2026, 9, 29), new Date(2026, 9, 30), new Date(2026, 9, 31)]);
  });

  it('starts on the previous Monday for a Sunday', () => {
    expect(buildWeek(new Date(2026, 10, 1))[0].date).toEqual(new Date(2026, 9, 26));
  });
});

describe('isoWeek', () => {
  it('numbers weeks like ISO 8601', () => {
    expect(isoWeek(new Date(2026, 9, 27))).toBe(44);
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53); // Friday, belongs to the last week of 2026
    expect(isoWeek(new Date(2027, 0, 4))).toBe(1);
    expect(isoWeek(new Date(2025, 11, 29))).toBe(1); // Monday, first week of 2026
  });
});

describe('shiftDate', () => {
  it('moves by day, month and year', () => {
    const date = new Date(2026, 9, 26);
    expect(shiftDate(date, 'day', 1)).toEqual(new Date(2026, 9, 27));
    expect(shiftDate(date, 'month', -1)).toEqual(new Date(2026, 8, 26));
    expect(shiftDate(date, 'year', 1)).toEqual(new Date(2027, 9, 26));
  });

  it('moves by a week', () => {
    expect(shiftDate(new Date(2026, 9, 29), 'week', 1)).toEqual(new Date(2026, 10, 5));
    expect(shiftDate(new Date(2026, 9, 29), 'week', -1, 3)).toEqual(new Date(2026, 9, 26));
  });

  it('keeps the end of the month when the next month is shorter', () => {
    expect(shiftDate(new Date(2027, 0, 31), 'month', 1)).toEqual(new Date(2027, 1, 28));
  });
});

describe('visibleRange', () => {
  it('covers the whole month grid', () => {
    const { from, to } = visibleRange(new Date(2026, 9, 15), 'month');
    expect(from).toEqual(new Date(2026, 8, 28));
    expect(to).toEqual(new Date(2026, 10, 2));
  });

  it('covers Monday to Sunday for a week', () => {
    const { from, to } = visibleRange(new Date(2026, 9, 29), 'week');
    expect(from).toEqual(new Date(2026, 9, 26));
    expect(to).toEqual(new Date(2026, 10, 2));
    expect(visibleRange(new Date(2026, 9, 29), 'week', 3)).toEqual({ from: new Date(2026, 9, 29), to: new Date(2026, 10, 1) });
  });
});

describe('eventsOnDay', () => {
  it('lists all-day events first and includes events spanning the day', () => {
    const morning = event('morning', at(9), at(10));
    const allDay = event('allDay', new Date(2026, 10, 3), new Date(2026, 10, 4), true);
    const overnight = event('overnight', at(22, 0, 2), at(2));
    const tomorrow = event('tomorrow', at(9, 0, 4), at(10, 0, 4));

    expect(eventsOnDay([morning, tomorrow, overnight, allDay], new Date(2026, 10, 3)).map((e) => e.id)).toEqual([
      'allDay',
      'overnight',
      'morning',
    ]);
  });

  it('does not show an all-day event on the following day', () => {
    const allDay = event('allDay', new Date(2026, 10, 3), new Date(2026, 10, 4), true);
    expect(eventsOnDay([allDay], new Date(2026, 10, 4))).toEqual([]);
  });
});

describe('layoutDay', () => {
  it('uses the full width for an event without overlap', () => {
    const [placed] = layoutDay([event('a', at(6), at(12))], new Date(2026, 10, 3));
    expect(placed.top).toBe(25);
    expect(placed.height).toBe(25);
    expect(placed.left).toBe(0);
    expect(placed.width).toBe(100);
  });

  it('puts simultaneous events side by side', () => {
    const placed = layoutDay(
      [event('a', at(9), at(11)), event('b', at(10), at(12)), event('c', at(11), at(12)), event('d', at(14), at(15))],
      new Date(2026, 10, 3)
    );
    const byId = Object.fromEntries(placed.map((p) => [p.event.id, p]));

    expect(byId['a'].width).toBe(50);
    expect(byId['b'].width).toBe(50);
    expect(byId['a'].left).toBe(0);
    expect(byId['b'].left).toBe(50);
    // c starts when a ends and takes its column
    expect(byId['c'].left).toBe(0);
    // d does not overlap anything
    expect(byId['d'].width).toBe(100);
  });

  it('clips events to the day and skips all-day events', () => {
    const placed = layoutDay(
      [event('overnight', at(18, 0, 2), at(6)), event('allDay', new Date(2026, 10, 3), new Date(2026, 10, 4), true)],
      new Date(2026, 10, 3)
    );
    expect(placed.map((p) => [p.event.id, p.top, p.height])).toEqual([['overnight', 0, 25]]);
  });
});
