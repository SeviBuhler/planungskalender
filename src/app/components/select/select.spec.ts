import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Select, SelectOption } from './select';

@Component({
  imports: [Select],
  template: `<app-select ariaLabel="Farbe" [options]="options" [value]="value()" (valueChange)="value.set($event)" />
             <p id="outside">draussen</p>`,
})
class Host {
  options: SelectOption[] = [
    { value: 'r', label: 'Rot' },
    { value: 'g', label: 'Grün' },
    { value: 'b', label: 'Blau' },
  ];
  value = signal('g');
}

describe('Select', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const button = el.querySelector<HTMLButtonElement>('button[role="combobox"]')!;
    const render = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    };
    return { fixture, el, button, render };
  }

  it('shows the selected label and picks an option with the mouse', async () => {
    const { fixture, el, button, render } = await setup();
    expect(button.textContent).toContain('Grün');

    button.click();
    await render();
    const options = el.querySelectorAll<HTMLElement>('[role="option"]');
    expect(options.length).toBe(3);
    expect(options[1].getAttribute('aria-selected')).toBe('true');

    options[2].click();
    await render();
    expect(fixture.componentInstance.value()).toBe('b');
    expect(el.querySelector('[role="listbox"]')).toBeNull();
  });

  it('works with the keyboard', async () => {
    const { fixture, button, render } = await setup();
    const key = async (key: string) => {
      button.dispatchEvent(new KeyboardEvent('keydown', { key }));
      await render();
    };
    await key('ArrowDown'); // opens on the selected option
    await key('ArrowDown');
    await key('Enter');
    expect(fixture.componentInstance.value()).toBe('b');

    await key('ArrowUp');
    await key('Escape');
    expect(fixture.componentInstance.value()).toBe('b');
  });

  it('closes on a click outside', async () => {
    const { el, button, render } = await setup();
    button.click();
    await render();
    el.querySelector('#outside')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await render();
    expect(el.querySelector('[role="listbox"]')).toBeNull();
  });
});
