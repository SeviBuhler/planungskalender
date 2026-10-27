import { Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';

export interface TitleOption {
  value: string;
  label: string;
  // Second line, e.g. the household or "Privat"
  sub: string;
  shared: boolean;
}

// Phones: the page title doubles as a picker, e.g. for the finance plan or the shopping list
@Component({
  selector: 'app-title-picker',
  host: {
    class: 'relative flex min-w-0',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'open.set(false)',
  },
  template: `
    <button type="button" aria-haspopup="menu" [attr.aria-expanded]="open()" [attr.aria-label]="ariaLabel() + ': ' + (current()?.label ?? '')"
            class="flex min-w-0 items-center gap-1 text-left" (click)="open.set(!open())">
      <span class="truncate">{{ current()?.label }}</span>
      <svg class="size-5 shrink-0 text-[#7040E8] transition-transform dark:text-[#B590FF]" [class.rotate-180]="open()" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
    </button>
    @if (open()) {
      <div role="menu" [attr.aria-label]="ariaLabel()" class="absolute left-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-white/95 p-1.5 text-base font-normal shadow-xl ring-1 ring-black/5 backdrop-blur-xl dark:bg-indigo-950/95 dark:ring-white/10"
           animate.enter="anim-drop-in" animate.leave="anim-drop-out">
        @for (option of options(); track option.value) {
          <button role="menuitemradio" type="button" [attr.aria-checked]="option.value === value()" (click)="choose(option.value)"
                  [class]="'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ' + (option.value === value()
                    ? 'bg-[#7040E8]/15 text-[#7040E8] dark:text-[#B590FF]' : 'text-[#25134D] hover:bg-indigo-50 dark:text-sky-100 dark:hover:bg-indigo-800')">
            <svg class="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              @if (option.shared) {
                <circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><circle cx="17" cy="9" r="2.5" /><path d="M15.5 14.5A5 5 0 0 1 21 19" />
              } @else {
                <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
              }
            </svg>
            <span class="min-w-0 flex-1">
              <span class="block truncate" [class.font-semibold]="option.value === value()">{{ option.label }}</span>
              <span class="block truncate text-xs opacity-60">{{ option.sub }}</span>
            </span>
            @if (option.value === value()) { <span aria-hidden="true">✓</span> }
          </button>
        }
      </div>
    }
  `,
})
export class TitlePicker {
  readonly options = input.required<TitleOption[]>();
  readonly value = input<string | null | undefined>(null);
  readonly ariaLabel = input('');
  readonly valueChange = output<string>();
  readonly open = signal(false);
  readonly current = computed(() => this.options().find((o) => o.value === this.value()) ?? null);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  choose(value: string) {
    this.open.set(false);
    if (value !== this.value()) this.valueChange.emit(value);
  }

  onDocumentPointerDown(event: Event) {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}
