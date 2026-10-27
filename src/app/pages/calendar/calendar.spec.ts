import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Calendar } from './calendar';
import { CalendarEvent } from '../../features/calendar/calendar-layout';
import { CalendarStore, EventInput } from '../../features/calendar/calendar-store';
import { Household, HouseholdStore } from '../../features/households/household-store';
import { ConfirmService } from '../../components/confirm/confirm';

class FakeCalendarStore {
  events: CalendarEvent[] = [];
  ranges: [Date, Date][] = [];
  private nextId = 1;

  async userId() { return 'me'; }
  async listRange(from: Date, to: Date) {
    this.ranges.push([from, to]);
    return this.events.filter((e) => e.start < to && e.end >= from);
  }
  async create(inputs: EventInput[]) {
    for (const input of inputs) this.events.push({ ...input, id: `e${this.nextId++}`, ownerId: 'me' });
  }
  async update(id: string, input: EventInput) {
    this.events = this.events.map((e) => (e.id === id ? { ...e, ...input } : e));
  }
  async delete(id: string) { this.events = this.events.filter((e) => e.id !== id); }
  async deleteSeriesFrom(seriesId: string, from: Date) {
    this.events = this.events.filter((e) => e.seriesId !== seriesId || e.start < from);
  }
}

class FakeHouseholdStore {
  households: Household[] = [
    { id: 'h1', name: 'Wir zwei', inviteCode: 'A', memberCount: 2, modules: ['calendar'] },
    { id: 'h2', name: 'Nur Finanzen', inviteCode: 'B', memberCount: 2, modules: ['finance'] },
  ];
  async list() { return this.households; }
}

function pointer(type: string, x: number, y = 0) {
  return { clientX: x, clientY: y, type } as PointerEvent;
}

describe('Calendar', () => {
  let store: FakeCalendarStore;
  let fixture: ComponentFixture<Calendar>;
  let component: Calendar;

  beforeEach(async () => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 26, 12));
    store = new FakeCalendarStore();
    store.events.push({
      id: 'x', title: 'Zahnarzt', description: null, start: new Date(2026, 9, 28, 9), end: new Date(2026, 9, 28, 10),
      allDay: false, ownerId: 'me', householdId: null, category: null, seriesId: null, recurrence: null, recurrenceUntil: null, reminderMinutes: null,
    });
    await TestBed.configureTestingModule({
      imports: [Calendar],
      providers: [
        provideRouter([]),
        { provide: CalendarStore, useValue: store },
        { provide: HouseholdStore, useValue: new FakeHouseholdStore() },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Calendar);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => vi.useRealTimers());

  it('loads the events of the visible month', () => {
    expect(component.view()).toBe('month');
    expect(store.ranges[0]).toEqual([new Date(2026, 7, 31), new Date(2026, 11, 7)]);
    expect(component.eventsFor(new Date(2026, 9, 28)).map((e) => e.title)).toEqual(['Zahnarzt']);
  });

  it('switches between year, month and day', () => {
    component.setView('year');
    component.next();
    expect(component.title()).toBe('2027');

    component.openMonth(2);
    expect(component.view()).toBe('month');
    expect(component.date()).toEqual(new Date(2027, 2, 1));

    component.openDay(new Date(2027, 2, 14));
    expect(component.view()).toBe('day');
    component.previous();
    expect(component.date()).toEqual(new Date(2027, 2, 13));
  });

  it('shows a week from Monday to Sunday and moves by weeks', () => {
    component.setView('week');
    fixture.detectChanges();
    expect(component.title()).toBe('26. Okt. – 1. Nov. 2026 · KW 44');
    const week = component.pages().find((p) => p.offset === 0)!.weekDays;
    expect(week.map((d) => d.date.getDate())).toEqual([26, 27, 28, 29, 30, 31, 1]);
    expect(week[2].positioned.map((p) => p.event.title)).toEqual(['Zahnarzt']);
    expect(fixture.nativeElement.textContent).toContain('Zahnarzt');

    component.next();
    expect(component.date()).toEqual(new Date(2026, 10, 2));
    component.openDay(new Date(2026, 10, 4));
    expect(component.view()).toBe('day');
  });

  it('shows three days from the shown date on small screens', () => {
    component.compact.set(true);
    component.setView('week');
    expect(component.title()).toBe('26. – 28. Okt. 2026 · KW 44');
    expect(component.pages().find((p) => p.offset === 0)!.weekDays.length).toBe(3);
    component.next();
    expect(component.date()).toEqual(new Date(2026, 9, 29));
    expect(component.title()).toBe('29. – 31. Okt. 2026 · KW 44');
  });

  it('shows the week strip in the day view and switches days with it', () => {
    component.openDay(new Date(2026, 9, 27));
    fixture.detectChanges();
    expect(component.title()).toBe('26. Okt. – 1. Nov. 2026 · KW 44');
    const strip = component.weekStrip();
    expect(strip.map((d) => d.weekday)).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
    expect(strip[1].selected).toBe(true);
    expect(strip[2].dots.length).toBe(1);

    component.selectDay(new Date(2026, 9, 28));
    expect(component.date()).toEqual(new Date(2026, 9, 28));
    expect(component.dayHeading()).toBe('Mittwoch, 28. Oktober 2026');
  });

  it('changes the month with a horizontal swipe or mouse drag', () => {
    component.onPointerDown(pointer('pointerdown', 300));
    component.onPointerUp(pointer('pointerup', 100));
    expect(component.date().getMonth()).toBe(10);

    // the click after the drag does not open a day
    component.openDay(new Date(2026, 10, 5));
    expect(component.view()).toBe('month');

    component.onPointerDown(pointer('pointerdown', 100));
    component.onPointerUp(pointer('pointerup', 110, 200)); // mostly vertical: scrolling, not a swipe
    expect(component.date().getMonth()).toBe(10);
  });

  it('lets the page follow the pointer and glides to the next page', () => {
    component.onPointerDown(pointer('pointerdown', 300));
    component.onPointerMove(pointer('pointermove', 295));
    expect(component.dragging()).toBe(false); // too small to be a drag
    component.onPointerMove(pointer('pointermove', 220));
    expect(component.dragging()).toBe(true);
    expect(component.trackTransform()).toBe('translateX(calc(-100% + -80px))');

    component.onPointerUp(pointer('pointerup', 200));
    expect(component.date().getMonth()).toBe(10);
    // the old page (now on the left) stays where the finger left it, then the track glides
    expect(component.trackTransform()).toBe('translateX(calc(0% + -100px))');
    expect(component.pages().map((p) => p.offset)).toEqual([-1, 0, 1]);
    expect(component.pages()[1].monthDays.some((d) => d.inMonth && d.date.getMonth() === 10)).toBe(true);
  });

  it('snaps back after a short slow drag and pages on a quick flick', () => {
    const at = (type: string, x: number, timeStamp: number) => ({ clientX: x, clientY: 0, type, timeStamp }) as PointerEvent;
    component.onPointerDown(at('pointerdown', 300, 0));
    component.onPointerMove(at('pointermove', 270, 400));
    component.onPointerUp(at('pointerup', 270, 800));
    expect(component.date().getMonth()).toBe(9);
    expect(component.dragX()).toBe(0);

    component.onPointerDown(at('pointerdown', 300, 1000));
    component.onPointerMove(at('pointermove', 290, 1010));
    component.onPointerMove(at('pointermove', 270, 1030)); // 1 px per ms
    component.onPointerUp(at('pointerup', 270, 1035));
    expect(component.date().getMonth()).toBe(10);
  });

  it('loads the events of the neighbouring pages and the whole week of the day too', async () => {
    component.openDay(new Date(2026, 9, 28));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(store.ranges.at(-1)).toEqual([new Date(2026, 9, 26), new Date(2026, 10, 2)]);

    component.openDay(new Date(2026, 10, 1)); // Sunday: the next day lies in the following week
    fixture.detectChanges();
    await fixture.whenStable();
    expect(store.ranges.at(-1)).toEqual([new Date(2026, 9, 26), new Date(2026, 10, 9)]);
  });

  it('creates a timed event in a household with the calendar module', async () => {
    expect(component.calendarHouseholds().map((h) => h.name)).toEqual(['Wir zwei']);

    component.openDay(new Date(2026, 9, 30));
    component.newEventAt(14);
    expect(component.form()?.startTime).toBe('14:00');
    expect(component.form()?.endTime).toBe('15:00');

    component.patchForm({ title: 'Kino', householdChoice: 'h1' });
    await component.saveEvent();

    const created = store.events.find((e) => e.title === 'Kino')!;
    expect(created.start).toEqual(new Date(2026, 9, 30, 14));
    expect(created.householdId).toBe('h1');
    expect(component.form()).toBeNull();
    expect(component.positionedEvents().map((p) => p.event.title)).toEqual(['Kino']);
  });

  it('stores all-day events up to the start of the following day', async () => {
    component.newEvent();
    component.patchForm({ title: 'Ferien', allDay: true, startDate: '2026-11-02', endDate: '2026-11-06' });
    await component.saveEvent();

    const created = store.events.find((e) => e.title === 'Ferien')!;
    expect(created.start).toEqual(new Date(2026, 10, 2));
    expect(created.end).toEqual(new Date(2026, 10, 7));

    component.editEvent(created);
    expect(component.form()?.endDate).toBe('2026-11-06');
  });

  it('rejects an end before the start', async () => {
    component.newEvent();
    component.patchForm({ title: 'Falsch', startTime: '10:00', endTime: '09:00' });
    await component.saveEvent();
    expect(component.errorText()).toBe('Das Ende liegt vor dem Beginn');
    expect(store.events.length).toBe(1);
  });

  it('stores the category', async () => {
    component.newEvent();
    component.patchForm({ title: 'Lauftraining', category: 'leisure' });
    await component.saveEvent();
    const created = store.events.find((e) => e.title === 'Lauftraining')!;
    expect(created.category).toBe('leisure');
    expect(component.tileClass(created)).toContain('violet');
  });

  it('stores the reminder and clears it when switching to all-day', async () => {
    component.newEvent();
    component.patchForm({ title: 'Arzt', reminder: '15' });
    await component.saveEvent();
    expect(store.events.find((e) => e.title === 'Arzt')!.reminderMinutes).toBe(15);

    component.newEvent();
    component.patchForm({ title: 'Ferien', reminder: '15' });
    component.patchForm({ allDay: true });
    expect(component.form()!.reminder).toBe('');
    component.patchForm({ reminder: '-540' });
    await component.saveEvent();
    expect(store.events.find((e) => e.title === 'Ferien')!.reminderMinutes).toBe(-540);
  });

  it('creates a weekly series up to the end date', async () => {
    component.newEvent(new Date(2026, 10, 2, 18));
    component.patchForm({ title: 'Yoga' });
    component.setRecurrence('weekly');
    expect(component.form()?.recurrenceUntil).toBe('2027-11-02');
    component.patchForm({ recurrenceUntil: '2026-11-30' });
    await component.saveEvent();

    const yoga = store.events.filter((e) => e.title === 'Yoga');
    expect(yoga.map((e) => e.start.getDate())).toEqual([2, 9, 16, 23, 30]);
    expect(new Set(yoga.map((e) => e.seriesId)).size).toBe(1);
    expect(yoga[0].recurrence).toBe('weekly');
  });

  async function createSeries() {
    component.newEvent(new Date(2026, 10, 2, 18));
    component.patchForm({ title: 'Yoga', recurrence: 'weekly', recurrenceUntil: '2026-11-30' });
    await component.saveEvent();
    return () => store.events.filter((e) => e.seriesId).sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  it('changes a single occurrence and keeps it in the series', async () => {
    const series = await createSeries();
    component.editEvent(series()[1]);
    expect(component.showRecurrence(component.form()!)).toBe(false);
    component.patchForm({ title: 'Yoga (Halle 2)', startTime: '19:00', endTime: '20:00' });
    await component.saveEvent();

    expect(series().map((e) => e.title)).toEqual(['Yoga', 'Yoga (Halle 2)', 'Yoga', 'Yoga', 'Yoga']);
    expect(series()[1].start).toEqual(new Date(2026, 10, 9, 19));
  });

  it('changes this and all following occurrences', async () => {
    const series = await createSeries();
    component.editEvent(series()[2]);
    component.patchForm({ scope: 'following', title: 'Pilates', recurrence: 'biweekly' });
    await component.saveEvent();

    expect(series().map((e) => `${e.title} ${e.start.getDate()}`)).toEqual(['Yoga 2', 'Yoga 9', 'Pilates 16', 'Pilates 30']);
  });

  it('deletes this and all following occurrences', async () => {
    const series = await createSeries();
    vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(true);
    component.editEvent(series()[3]);
    component.patchForm({ scope: 'following' });
    await component.deleteEvent();
    expect(series().map((e) => e.start.getDate())).toEqual([2, 9, 16]);
  });

  it('rejects a repeat end before the start', async () => {
    component.newEvent(new Date(2026, 10, 2, 18));
    component.patchForm({ title: 'Yoga', recurrence: 'daily', recurrenceUntil: '2026-11-01' });
    await component.saveEvent();
    expect(component.errorText()).toBe('Das Wiederholungsende liegt vor dem Beginn');
  });

  it('offers "Heute" on phones only once the shown page no longer contains today', () => {
    expect(component.showsToday()).toBe(true);
    component.next();
    expect(component.showsToday()).toBe(false);
    expect(component.mobileTitle()).toBe('November 2026');
    component.goToToday();
    component.setView('day');
    expect(component.showsToday()).toBe(true);
    component.next();
    expect(component.showsToday()).toBe(false);
    component.setView('year');
    expect(component.showsToday()).toBe(true);
    expect(component.mobileTitle()).toBe('2026');
  });

  it('remembers the chosen view for the next visit', () => {
    component.setView('week');
    expect(localStorage.getItem('fortwo.calendarView')).toBe('week');
    const again = TestBed.createComponent(Calendar).componentInstance;
    expect(again.view()).toBe('week');
  });
});
