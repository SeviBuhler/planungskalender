import { Directive, ElementRef, inject } from '@angular/core';

// Marks the whole value when the field gets focus, so a tap on "0" replaces it instead of typing in front of it.
// Mobile Safari moves the caret after the focus event, so the selection waits a tick
@Directive({
  selector: 'input[appSelectAll]',
  host: { '(focus)': 'selectAll()' },
})
export class SelectAll {
  private readonly input = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;

  selectAll() {
    setTimeout(() => {
      if (document.activeElement === this.input) this.input.select();
    });
  }
}
