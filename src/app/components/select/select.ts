import { Component, DestroyRef, ElementRef, computed, input, output, signal } from '@angular/core';

export interface SelectOption {
  value: string;
  label: string;
}

let nextId = 0;

// Dropdown with a soft open animation, keyboard support and closing on outside clicks
@Component({
  selector: 'app-select',
  templateUrl: './select.html',
  host: {
    class: 'relative block',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(window:resize)': 'open.set(false)',
  },
})
export class Select {
  readonly options = input.required<SelectOption[]>();
  readonly value = input<string | null | undefined>(null);
  readonly ariaLabel = input<string>('');
  readonly valueChange = output<string>();

  readonly open = signal(false);
  readonly active = signal(0);
  // The list is positioned fixed so scrolling dialogs do not cut it off; it opens upwards near the bottom
  readonly position = signal<{ top: number | null; bottom: number | null; left: number; width: number } | null>(null);
  readonly listId = `app-select-${nextId++}`;
  readonly selected = computed(() => this.options().find((o) => o.value === this.value()) ?? null);

  constructor(private host: ElementRef<HTMLElement>, destroyRef: DestroyRef) {
    // Scroll events do not bubble, so listen in the capture phase to catch scrolling dialogs too
    const onScroll = (event: Event) => this.onScroll(event);
    document.addEventListener('scroll', onScroll, true);
    destroyRef.onDestroy(() => document.removeEventListener('scroll', onScroll, true));
  }

  toggle() {
    if (this.open()) {
      this.open.set(false);
      return;
    }
    this.active.set(Math.max(0, this.options().findIndex((o) => o.value === this.value())));
    const rect = this.host.nativeElement.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const up = below < 270 && rect.top > below;
    this.position.set({
      top: up ? null : rect.bottom + 4,
      bottom: up ? window.innerHeight - rect.top + 4 : null,
      left: rect.left,
      width: rect.width,
    });
    this.open.set(true);
  }

  choose(option: SelectOption) {
    this.open.set(false);
    if (option.value !== this.value()) this.valueChange.emit(option.value);
  }

  onKeydown(event: KeyboardEvent) {
    const count = this.options().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        if (!this.open()) {
          this.toggle();
          return;
        }
        this.active.update((i) => (i + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (this.open() && this.options()[this.active()]) this.choose(this.options()[this.active()]);
        else this.toggle();
        return;
      case 'Escape':
      case 'Tab':
        this.open.set(false);
    }
  }

  // Scrolling the page or a dialog moves the button away from the fixed list
  onScroll(event: Event) {
    const list = this.host.nativeElement.querySelector('[role="listbox"]');
    if (this.open() && !list?.contains(event.target as Node)) this.open.set(false);
  }

  onDocumentPointerDown(event: Event) {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}
