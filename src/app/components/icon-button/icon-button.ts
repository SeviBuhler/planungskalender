import { Component, computed, input } from '@angular/core';

// Small square button with an × icon, used for removing rows and closing panels. Put it on a <button> and give it an aria-label
@Component({
  selector: 'button[appIconButton]',
  template: `
    <svg class="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  `,
  host: {
    type: 'button',
    class:
      'inline-flex size-10 sm:size-9 shrink-0 items-center justify-center justify-self-end rounded-lg bg-white shadow-sm ring-1 ring-black/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95',
    '[class]': 'toneClass()',
  },
})
export class IconButton {
  readonly tone = input<'danger' | 'neutral'>('danger');
  readonly toneClass = computed(() =>
    this.tone() === 'danger' ? 'text-red-700 hover:bg-red-50 hover:ring-red-300' : 'text-gray-600 hover:bg-gray-50 hover:ring-indigo-300',
  );
}
