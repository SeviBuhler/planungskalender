import { Component, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Supabase } from '../../services/supabase';
import {
  CalendarEvent,
  CalendarView,
  Category,
  Recurrence,
  addDays,
  buildMonthGrid,
  eventsOnDay,
  isSameDay,
  layoutDay,
  shiftDate,
  startOfDay,
  visibleRange,
} from '../../features/calendar/calendar-layout';
import { CalendarStore, EventInput } from '../../features/calendar/calendar-store';
import { CATEGORIES, DEFAULT_TILE, MAX_OCCURRENCES, RECURRENCES, occurrences } from '../../features/calendar/recurrence';
import { Household, HouseholdStore } from '../../features/households/household-store';
import { ConfirmService } from '../../components/confirm/confirm';
import { Select, SelectOption } from '../../components/select/select';
import { SubscribeDialog } from './subscribe-dialog';
import { PageHeader } from '../../components/page-header/page-header';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const SWIPE_MIN_PX = 60;
const FLICK_MIN_PX = 20;
const FLICK_MIN_SPEED = 0.4; // px per ms
const MAX_TILES = 3;

interface EventForm {
  original: CalendarEvent | null; // the event being edited
  title: string;
  description: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  householdChoice: string; // 'private' or a household id
  category: Category | '';
  recurrence: Recurrence | 'none';
  recurrenceUntil: string;
  scope: 'one' | 'following'; // which occurrences of a series a change applies to
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function fromInputs(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = (time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, h, min);
}

function monthsOfYear(year: number) {
  return Array.from({ length: 12 }, (_, month) => ({
    month,
    label: new Date(2000, month, 1).toLocaleDateString('de-CH', { month: 'long' }),
    days: buildMonthGrid(year, month),
  }));
}

function errorMessage(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: string }).message)
    : 'Unbekannter Fehler';
}

@Component({
  selector: 'app-calendar',
  imports: [PageHeader, FormsModule, Select, SubscribeDialog],
  templateUrl: './calendar.html',
  styleUrl: './calendar.css',
})
export class Calendar {
  readonly weekdays = WEEKDAYS;
  readonly hours = Array.from({ length: 24 }, (_, i) => i);
  readonly maxTiles = MAX_TILES;
  readonly scopeOptions: SelectOption[] = [
    { value: 'one', label: 'Nur diesen Termin' },
    { value: 'following', label: 'Diesen und alle folgenden' },
  ];
  readonly recurrenceOptions: SelectOption[] = [
    { value: 'none', label: 'Nie' },
    ...RECURRENCES.map((r) => ({ value: r.id, label: r.label })),
  ];
  readonly categoryOptions: SelectOption[] = [
    { value: '', label: 'Keine' },
    ...CATEGORIES.map((c) => ({ value: c.id, label: c.label })),
  ];

  readonly view = signal<CalendarView>('month');
  readonly date = signal(startOfDay(new Date()));
  readonly events = signal<CalendarEvent[]>([]);
  readonly households = signal<Household[]>([]);
  readonly calendarHouseholds = computed(() => this.households().filter((h) => h.modules.includes('calendar')));
  readonly visibilityOptions = computed<SelectOption[]>(() => [
    { value: 'private', label: 'Nur ich' },
    ...this.calendarHouseholds().map((h) => ({ value: h.id, label: `Haushalt „${h.name}“` })),
  ]);
  readonly errorText = signal('');
  // Swipe carousel: previous, current and next page sit side by side and the track follows the
  // pointer. Changing the page moves the track by one page width (-100% shows the current page).
  readonly dragX = signal(0);
  readonly dragging = signal(false);
  readonly trackShift = signal(0); // extra percent, used to start the slide from where the old page is
  readonly trackAnimated = signal(true);
  readonly trackTransform = computed(() => `translateX(calc(${this.trackShift() - 100}% + ${this.dragX()}px))`);
  readonly fadeClass = signal('');
  readonly form = signal<EventForm | null>(null);
  readonly subscribeOpen = signal(false);

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
  readonly yearMonths = computed(() => monthsOfYear(this.date().getFullYear()));
  readonly dayEvents = computed(() => eventsOnDay(this.visibleEvents(), this.date()));
  readonly allDayEvents = computed(() => this.dayEvents().filter((e) => e.allDay));
  readonly positionedEvents = computed(() => layoutDay(this.visibleEvents(), this.date()));

  readonly pages = computed(() => {
    const view = this.view();
    const events = this.visibleEvents();
    return ([-1, 0, 1] as const).map((offset) => {
      const date = offset === 0 ? this.date() : shiftDate(this.date(), view, offset);
      return {
        offset,
        key: `${view}:${date.getTime()}`,
        monthDays: view === 'month' ? buildMonthGrid(date.getFullYear(), date.getMonth()) : [],
        yearMonths: view === 'year' ? monthsOfYear(date.getFullYear()) : [],
        allDay: view === 'day' ? eventsOnDay(events, date).filter((e) => e.allDay) : [],
        positioned: view === 'day' ? layoutDay(events, date) : [],
      };
    });
  });

  // Shared events of households that switched the calendar module off stay hidden
  private readonly visibleEvents = computed(() =>
    this.events().filter((e) => e.householdId === null || this.calendarHouseholds().some((h) => h.id === e.householdId))
  );

  private pointerStart: { x: number; y: number } | null = null;
  private lastMove: { x: number; time: number; speed: number } | null = null;
  private suppressClick = false;
  private loadToken = 0;

  constructor(
    public supabase: Supabase,
    private store: CalendarStore,
    private householdStore: HouseholdStore,
    private confirm: ConfirmService
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
    // Also load the neighbouring pages, they are visible while swiping
    const from = visibleRange(shiftDate(date, view, -1), view).from;
    const to = visibleRange(shiftDate(date, view, 1), view).to;
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

  tileClass(event: CalendarEvent): string {
    return CATEGORIES.find((c) => c.id === event.category)?.tile ?? DEFAULT_TILE;
  }

  // Recurrence can be set for new events, single events and "this and following"
  showRecurrence(f: EventForm): boolean {
    return !f.original?.seriesId || f.scope === 'following';
  }

  householdName(event: CalendarEvent): string | null {
    return this.households().find((h) => h.id === event.householdId)?.name ?? null;
  }

  isToday(day: Date): boolean {
    return isSameDay(day, new Date());
  }

  setView(view: CalendarView) {
    if (view === this.view()) return;
    this.fadeClass.set('anim-fade-in');
    this.view.set(view);
  }

  previous() {
    this.slide(-1);
  }

  next() {
    this.slide(1);
  }

  goToToday() {
    const today = startOfDay(new Date());
    if (today.getTime() === this.date().getTime()) return;
    this.fadeClass.set('anim-fade-in');
    this.date.set(today);
  }

  // Switches the page right away and lets the track glide from where the old page is shown
  // (including the distance the finger already dragged) to the new page
  private slide(direction: -1 | 1) {
    const dragged = this.dragX();
    this.fadeClass.set('');
    this.trackAnimated.set(false);
    this.date.set(shiftDate(this.date(), this.view(), direction));
    this.trackShift.set(direction * 100);
    this.dragX.set(dragged);
    // Two frames: the jump without transition is painted before the glide starts
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.trackAnimated.set(true);
        this.trackShift.set(0);
        this.dragX.set(0);
      })
    );
  }

  openMonth(month: number) {
    if (this.consumeDrag()) return;
    this.fadeClass.set('anim-fade-in');
    this.date.set(new Date(this.date().getFullYear(), month, 1));
    this.view.set('month');
  }

  openDay(day: Date) {
    if (this.consumeDrag()) return;
    this.fadeClass.set('anim-fade-in');
    this.date.set(startOfDay(day));
    this.view.set('day');
  }

  // Swipe on touch screens and drag with the mouse: left = forward, right = back
  onPointerDown(event: PointerEvent) {
    this.pointerStart = { x: event.clientX, y: event.clientY };
    this.lastMove = { x: event.clientX, time: event.timeStamp, speed: 0 };
  }

  onPointerMove(event: PointerEvent) {
    if (!this.pointerStart) return;
    const dx = event.clientX - this.pointerStart.x;
    const dy = event.clientY - this.pointerStart.y;
    if (this.lastMove && event.timeStamp > this.lastMove.time) {
      const speed = (event.clientX - this.lastMove.x) / (event.timeStamp - this.lastMove.time);
      this.lastMove = { x: event.clientX, time: event.timeStamp, speed };
    }
    if (!this.dragging()) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      this.dragging.set(true);
      this.trackAnimated.set(false);
      // Keep receiving moves when the mouse leaves the calendar while dragging
      (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    }
    this.dragX.set(dx);
  }

  onPointerUp(event: PointerEvent) {
    if (!this.pointerStart) return;
    const dx = event.clientX - this.pointerStart.x;
    const dy = event.clientY - this.pointerStart.y;
    const speed = this.lastMove?.speed ?? 0;
    this.pointerStart = null;
    this.lastMove = null;
    this.dragging.set(false);
    const horizontal = Math.abs(dx) >= Math.abs(dy) * 1.5;
    // A long drag or a quick flick in the same direction changes the page
    const flick = Math.abs(dx) >= FLICK_MIN_PX && Math.abs(speed) >= FLICK_MIN_SPEED && Math.sign(speed) === Math.sign(dx);
    if (!horizontal || (Math.abs(dx) < SWIPE_MIN_PX && !flick)) {
      this.snapBack();
      return;
    }
    // The click that follows the drag must not open a day or an event
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false));
    this.dragX.set(dx);
    if (dx < 0) this.next();
    else this.previous();
  }

  onPointerCancel() {
    this.pointerStart = null;
    this.lastMove = null;
    this.dragging.set(false);
    this.snapBack();
  }

  private snapBack() {
    this.trackAnimated.set(true);
    this.dragX.set(0);
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
      original: null,
      title: '',
      description: '',
      allDay: false,
      startDate: dateInput(from),
      startTime: timeInput(from),
      endDate: dateInput(to),
      endTime: timeInput(to),
      householdChoice: 'private',
      category: '',
      recurrence: 'none',
      recurrenceUntil: '',
      scope: 'one',
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
      original: event,
      title: event.title,
      description: event.description ?? '',
      allDay: event.allDay,
      startDate: dateInput(event.start),
      startTime: timeInput(event.start),
      endDate: dateInput(lastDay),
      endTime: timeInput(event.end),
      householdChoice: event.householdId ?? 'private',
      category: event.category ?? '',
      recurrence: event.recurrence ?? 'none',
      recurrenceUntil: event.recurrenceUntil ?? '',
      scope: 'one',
    });
  }

  patchForm(changes: Partial<EventForm>) {
    this.form.update((f) => (f ? { ...f, ...changes } : f));
  }

  setRecurrence(recurrence: Recurrence | 'none') {
    const f = this.form();
    if (!f) return;
    const rule = RECURRENCES.find((r) => r.id === recurrence);
    let until = f.recurrenceUntil;
    if (rule && !until) {
      const start = fromInputs(f.startDate, '00:00');
      until = dateInput(new Date(start.getFullYear(), start.getMonth() + rule.defaultMonths, start.getDate()));
    }
    this.patchForm({ recurrence, recurrenceUntil: until });
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
    const base = {
      title: f.title.trim(),
      description: f.description.trim() || null,
      allDay: f.allDay,
      householdId: f.householdChoice === 'private' ? null : f.householdChoice,
      category: f.category || null,
    };
    const original = f.original;
    const repeat = this.showRecurrence(f) && f.recurrence !== 'none' ? f.recurrence : null;
    // A single change keeps the occurrence in its series; everything else rebuilds the events
    const rebuild = !original || (original.seriesId ? f.scope === 'following' : repeat !== null);

    let inputs: EventInput[];
    if (!rebuild) {
      inputs = [{
        ...base, start, end,
        seriesId: original.seriesId, recurrence: original.recurrence, recurrenceUntil: original.recurrenceUntil,
      }];
    } else if (repeat) {
      if (!f.recurrenceUntil || fromInputs(f.recurrenceUntil, '00:00') < startOfDay(start)) {
        this.errorText.set('Das Wiederholungsende liegt vor dem Beginn');
        return;
      }
      const list = occurrences(start, end, repeat, fromInputs(f.recurrenceUntil, '00:00'));
      if (!list) {
        this.errorText.set(`Höchstens ${MAX_OCCURRENCES} Wiederholungen möglich`);
        return;
      }
      const seriesId = original?.seriesId ?? crypto.randomUUID();
      inputs = list.map((o) => ({ ...base, ...o, seriesId, recurrence: repeat, recurrenceUntil: f.recurrenceUntil }));
    } else {
      inputs = [{ ...base, start, end, seriesId: null, recurrence: null, recurrenceUntil: null }];
    }

    try {
      if (!rebuild) {
        await this.store.update(original!.id, inputs[0]);
      } else {
        if (original?.seriesId) await this.store.deleteSeriesFrom(original.seriesId, original.start);
        else if (original) await this.store.delete(original.id);
        await this.store.create(inputs);
      }
      this.closeForm();
      await this.reload();
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }

  async deleteEvent() {
    const f = this.form();
    const original = f?.original;
    if (!f || !original) return;
    const following = original.seriesId !== null && f.scope === 'following';
    const question = following ? `„${original.title}“ und alle folgenden Termine der Serie löschen?` : `Termin „${original.title}“ löschen?`;
    if (!(await this.confirm.ask(question, 'Löschen'))) return;
    try {
      if (following) await this.store.deleteSeriesFrom(original.seriesId!, original.start);
      else await this.store.delete(original.id);
      this.closeForm();
      await this.reload();
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }
}
