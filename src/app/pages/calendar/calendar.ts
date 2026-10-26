import { Component, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Supabase } from '../../services/supabase';
import {
  CalendarEvent,
  CalendarView,
  addDays,
  buildMonthGrid,
  eventsOnDay,
  isSameDay,
  layoutDay,
  shiftDate,
  startOfDay,
  visibleRange,
} from '../../features/calendar/calendar-layout';
import { CalendarStore } from '../../features/calendar/calendar-store';
import { Household, HouseholdStore } from '../../features/households/household-store';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const SWIPE_MIN_PX = 60;
const MAX_TILES = 3;

interface EventForm {
  id: string | null;
  title: string;
  description: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  householdChoice: string; // 'private' or a household id
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function fromInputs(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = (time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, h, min);
}

function errorMessage(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: string }).message)
    : 'Unbekannter Fehler';
}

@Component({
  selector: 'app-calendar',
  imports: [FormsModule, RouterLink],
  templateUrl: './calendar.html',
  styleUrl: './calendar.css',
})
export class Calendar {
  readonly weekdays = WEEKDAYS;
  readonly hours = Array.from({ length: 24 }, (_, i) => i);
  readonly maxTiles = MAX_TILES;

  readonly view = signal<CalendarView>('month');
  readonly date = signal(startOfDay(new Date()));
  readonly events = signal<CalendarEvent[]>([]);
  readonly households = signal<Household[]>([]);
  readonly calendarHouseholds = computed(() => this.households().filter((h) => h.modules.includes('calendar')));
  readonly errorText = signal('');
  readonly form = signal<EventForm | null>(null);

  readonly title = computed(() => {
    const date = this.date();
    switch (this.view()) {
      case 'year':
        return String(date.getFullYear());
      case 'month':
        return date.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });
      case 'day':
        return date.toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
  });

  readonly monthDays = computed(() => buildMonthGrid(this.date().getFullYear(), this.date().getMonth()));
  readonly yearMonths = computed(() =>
    Array.from({ length: 12 }, (_, month) => ({
      month,
      label: new Date(2000, month, 1).toLocaleDateString('de-CH', { month: 'long' }),
      days: buildMonthGrid(this.date().getFullYear(), month),
    }))
  );
  readonly dayEvents = computed(() => eventsOnDay(this.visibleEvents(), this.date()));
  readonly allDayEvents = computed(() => this.dayEvents().filter((e) => e.allDay));
  readonly positionedEvents = computed(() => layoutDay(this.visibleEvents(), this.date()));

  // Shared events of households that switched the calendar module off stay hidden
  private readonly visibleEvents = computed(() =>
    this.events().filter((e) => e.householdId === null || this.calendarHouseholds().some((h) => h.id === e.householdId))
  );

  private pointerStart: { x: number; y: number } | null = null;
  private suppressClick = false;
  private loadToken = 0;

  constructor(
    public supabase: Supabase,
    private router: Router,
    private store: CalendarStore,
    private householdStore: HouseholdStore
  ) {
    this.householdStore.list().then(
      (households) => this.households.set(households),
      (error) => this.errorText.set(errorMessage(error))
    );
    effect(() => {
      this.loadEvents(this.date(), this.view());
    });
  }

  private async loadEvents(date: Date, view: CalendarView) {
    if (view === 'year') return; // the year view only navigates
    const token = ++this.loadToken;
    const { from, to } = visibleRange(date, view);
    try {
      const events = await this.store.listRange(from, to);
      if (token === this.loadToken) this.events.set(events);
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }

  reload() {
    return this.loadEvents(this.date(), this.view());
  }

  eventsFor(day: Date): CalendarEvent[] {
    return eventsOnDay(this.visibleEvents(), day);
  }

  timeLabel(event: CalendarEvent): string {
    return event.allDay ? 'Ganztägig' : `${timeInput(event.start)}–${timeInput(event.end)}`;
  }

  householdName(event: CalendarEvent): string | null {
    return this.households().find((h) => h.id === event.householdId)?.name ?? null;
  }

  isToday(day: Date): boolean {
    return isSameDay(day, new Date());
  }

  setView(view: CalendarView) {
    this.view.set(view);
  }

  previous() {
    this.date.set(shiftDate(this.date(), this.view(), -1));
  }

  next() {
    this.date.set(shiftDate(this.date(), this.view(), 1));
  }

  goToToday() {
    this.date.set(startOfDay(new Date()));
  }

  openMonth(month: number) {
    if (this.consumeDrag()) return;
    this.date.set(new Date(this.date().getFullYear(), month, 1));
    this.view.set('month');
  }

  openDay(day: Date) {
    if (this.consumeDrag()) return;
    this.date.set(startOfDay(day));
    this.view.set('day');
  }

  // Swipe on touch screens and drag with the mouse: left = forward, right = back
  onPointerDown(event: PointerEvent) {
    this.pointerStart = { x: event.clientX, y: event.clientY };
  }

  onPointerUp(event: PointerEvent) {
    if (!this.pointerStart) return;
    const dx = event.clientX - this.pointerStart.x;
    const dy = event.clientY - this.pointerStart.y;
    this.pointerStart = null;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // The click that follows the drag must not open a day or an event
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false));
    if (dx < 0) this.next();
    else this.previous();
  }

  onPointerCancel() {
    this.pointerStart = null;
  }

  private consumeDrag(): boolean {
    return this.suppressClick;
  }

  newEvent(start?: Date) {
    if (this.consumeDrag()) return;
    const from = start ?? new Date(this.date().getFullYear(), this.date().getMonth(), this.date().getDate(), 9);
    const to = new Date(from.getTime() + 60 * 60 * 1000);
    this.errorText.set('');
    this.form.set({
      id: null,
      title: '',
      description: '',
      allDay: false,
      startDate: dateInput(from),
      startTime: timeInput(from),
      endDate: dateInput(to),
      endTime: timeInput(to),
      householdChoice: 'private',
    });
  }

  newEventAt(hour: number) {
    const day = this.date();
    this.newEvent(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour));
  }

  editEvent(event: CalendarEvent, domEvent?: Event) {
    domEvent?.stopPropagation();
    if (this.consumeDrag()) return;
    // All-day events store the day after the last day as end
    const lastDay = event.allDay ? addDays(event.end, -1) : event.end;
    this.errorText.set('');
    this.form.set({
      id: event.id,
      title: event.title,
      description: event.description ?? '',
      allDay: event.allDay,
      startDate: dateInput(event.start),
      startTime: timeInput(event.start),
      endDate: dateInput(lastDay),
      endTime: timeInput(event.end),
      householdChoice: event.householdId ?? 'private',
    });
  }

  patchForm(changes: Partial<EventForm>) {
    this.form.update((f) => (f ? { ...f, ...changes } : f));
  }

  closeForm() {
    this.form.set(null);
    this.errorText.set('');
  }

  async saveEvent() {
    const f = this.form();
    if (!f) return;
    if (!f.title.trim()) {
      this.errorText.set('Bitte einen Titel eingeben');
      return;
    }
    const start = f.allDay ? fromInputs(f.startDate, '00:00') : fromInputs(f.startDate, f.startTime);
    const end = f.allDay ? addDays(fromInputs(f.endDate, '00:00'), 1) : fromInputs(f.endDate, f.endTime);
    if (end < start) {
      this.errorText.set('Das Ende liegt vor dem Beginn');
      return;
    }
    const input = {
      title: f.title.trim(),
      description: f.description.trim() || null,
      start,
      end,
      allDay: f.allDay,
      householdId: f.householdChoice === 'private' ? null : f.householdChoice,
    };
    try {
      if (f.id) await this.store.update(f.id, input);
      else await this.store.create(input);
      this.closeForm();
      await this.reload();
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }

  async deleteEvent() {
    const f = this.form();
    if (!f?.id || !confirm(`Termin „${f.title}“ löschen?`)) return;
    try {
      await this.store.delete(f.id);
      this.closeForm();
      await this.reload();
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }

  async handleLogout() {
    const result = await this.supabase.client.auth.signOut()

    if (!result.error) {
      this.router.navigate(['/login'])
    }
  }
}
