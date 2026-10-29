import { Component } from '@angular/core';

// Small cake line icon in front of birthday events, in gold
@Component({
  selector: 'app-birthday-icon',
  host: { class: 'inline-block shrink-0 align-[-0.15em] text-amber-500' },
  template: `
    <svg class="size-[1.05em]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 20h16v-6.5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z" /><path d="M4 15.5c1.3 1.2 2.7 1.2 4 0s2.7-1.2 4 0 2.7 1.2 4 0 2.7-1.2 4 0" />
      <path d="M12 11.5V8" /><path d="M12 3.5c1 1.2 1 2.6 0 2.9-1-.3-1-1.7 0-2.9z" />
    </svg>`,
})
export class BirthdayIcon {}
