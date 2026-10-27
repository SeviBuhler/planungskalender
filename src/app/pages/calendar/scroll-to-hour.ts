import { Directive, ElementRef, afterNextRender, inject, input } from '@angular/core';

const HOUR_PX = 48; // h-12 per hour in the time grids

// Starts a time grid scrolled to the morning instead of midnight
@Directive({ selector: '[appScrollToHour]' })
export class ScrollToHour {
  readonly appScrollToHour = input(7);

  constructor() {
    const element = inject(ElementRef<HTMLElement>).nativeElement;
    // A few pixels less so the label of the hour line stays readable
    afterNextRender(() => (element.scrollTop = this.appScrollToHour() * HOUR_PX - 8));
  }
}
