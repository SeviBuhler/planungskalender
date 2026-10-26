import { TestBed } from '@angular/core/testing';
import { ConfirmDialog, ConfirmService } from './confirm';

describe('ConfirmDialog', () => {
  it('resolves with the button the user presses', async () => {
    const fixture = TestBed.createComponent(ConfirmDialog);
    const service = TestBed.inject(ConfirmService);
    const answer = service.ask('Wirklich löschen?', 'Löschen');
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Wirklich löschen?');
    const buttons = el.querySelectorAll('button');
    expect(buttons[1].textContent).toContain('Löschen');
    buttons[1].click();
    expect(await answer).toBe(true);
    expect(service.question()).toBeNull();
  });

  it('answers no on Escape and when a new question replaces an open one', async () => {
    const fixture = TestBed.createComponent(ConfirmDialog);
    const service = TestBed.inject(ConfirmService);
    const first = service.ask('Erste Frage?');
    const second = service.ask('Zweite Frage?');
    expect(await first).toBe(false);

    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await second).toBe(false);
  });
});
