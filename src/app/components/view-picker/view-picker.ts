import { Component, ElementRef, inject, input, output, signal } from '@angular/core';
import { CalendarView } from '../../features/calendar/calendar-layout';
import { GLASS } from '../page-header/page-header';

const VIEWS: { view: CalendarView; label: string; icon: string }[] = [
  { view: 'year', label: 'Jahr', icon: 'M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM10 10h4v4h-4zM16 10h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4zM16 16h4v4h-4z' },
  { view: 'month', label: 'Monat', icon: 'M6 4.5h12A2.5 2.5 0 0 1 20.5 7v11a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V7A2.5 2.5 0 0 1 6 4.5zM3.5 9h17M9.2 9v11.5M14.8 9v11.5M3.5 14.7h17' },
  { view: 'week', label: 'Woche', icon: 'M6 4.5h12A2.5 2.5 0 0 1 20.5 7v11a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V7A2.5 2.5 0 0 1 6 4.5zM3.5 9h17M9.2 9v11.5M14.8 9v11.5' },
  { view: 'day', label: 'Tag', icon: 'M6 4.5h12A2.5 2.5 0 0 1 20.5 7v11a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V7A2.5 2.5 0 0 1 6 4.5zM3.5 9h17M7 13h10M7 16.5h6' },
];

// Phones: year, month, week and day behind one calendar button with a small dropdown
@Component({
  selector: 'app-view-picker',
  host: {
    class: 'relative',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'open.set(false)',
  },
  template: `
    <button type="button" aria-haspopup="menu" [attr.aria-expanded]="open()" [attr.aria-label]="'Ansicht: ' + current().label"
            [class]="'flex h-11 items-center gap-0.5 rounded-full pl-3 pr-2 text-[#7040E8] dark:text-[#B590FF] active:scale-95 transition-transform ' + glass"
            (click)="open.set(!open())">
      <svg class="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="current().icon" /></svg>
      <svg class="size-4 transition-transform" [class.rotate-180]="open()" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
    </button>
    @if (open()) {
      <div role="menu" aria-label="Ansicht" class="absolute right-0 top-full z-50 mt-2 w-48 rounded-2xl bg-white/95 p-1.5 shadow-xl ring-1 ring-black/5 backdrop-blur-xl dark:bg-indigo-950/95 dark:ring-white/10"
           animate.enter="anim-drop-in" animate.leave="anim-drop-out">
        @for (option of views; track option.view) {
          <button role="menuitemradio" type="button" [attr.aria-checked]="option.view === view()" (click)="choose(option.view)"
                  [class]="'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ' + (option.view === view()
                    ? 'bg-[#7040E8]/15 font-semibold text-[#7040E8] dark:text-[#B590FF]' : 'text-[#25134D] hover:bg-indigo-50 dark:text-sky-100 dark:hover:bg-indigo-800')">
            <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="option.icon" /></svg>
            {{ option.label }}
            @if (option.view === view()) { <span class="ml-auto" aria-hidden="true">✓</span> }
          </button>
        }
      </div>
    }
  `,
})
export class ViewPicker {
  readonly view = input.required<CalendarView>();
  readonly viewChange = output<CalendarView>();
  readonly views = VIEWS;
  readonly glass = GLASS;
  readonly open = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  current() {
    return VIEWS.find((v) => v.view === this.view())!;
  }

  choose(view: CalendarView) {
    this.open.set(false);
    this.viewChange.emit(view);
  }

  onDocumentPointerDown(event: Event) {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}
