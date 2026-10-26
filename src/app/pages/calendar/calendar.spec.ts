import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Calendar } from './calendar';
import { CalendarEvent } from '../../features/calendar/calendar-layout';
import { CalendarStore, EventInput } from '../../features/calendar/calendar-store';
import { Household, HouseholdStore } from '../../features/households/household-store';

class FakeCalendarStore {
  events: CalendarEvent[] = [];
  ranges: [Date, Date][] = [];
  private nextId = 1;

  async userId() { return 'me'; }
  async listRange(from: Date, to: Date) {
    this.ranges.push([from, to]);
    return this.events.filter((e) => e.start < to && e.end >= from);
  }
  async create(input: EventInput) {
    const event = { ...input, id: `e${this.nextId++}`, ownerId: 'me' };
    this.events.push(event);
    return event;
  }
  async update(id: string, input: EventInput) {
    this.events = this.events.map((e) => (e.id === id ? { ...e, ...input } : e));
  }
  async delete(id: string) { this.events = this.events.filter((e) => e.id !== id); }
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
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 26, 12));
    store = new FakeCalendarStore();
    store.events.push({
      id: 'x', title: 'Zahnarzt', description: null, start: new Date(2026, 9, 28, 9), end: new Date(2026, 9, 28, 10),
      allDay: false, ownerId: 'me', householdId: null,
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
    expect(store.ranges[0]).toEqual([new Date(2026, 8, 28), new Date(2026, 10, 2)]);
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
});
