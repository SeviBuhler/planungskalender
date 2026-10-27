import { Component, output, signal } from '@angular/core';
import { PushReminders } from '../../features/calendar/push-reminders';

function errorMessage(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: string }).message)
    : 'Unbekannter Fehler';
}

// Switches the push reminders of the app on or off for this device
@Component({
  selector: 'app-reminder-dialog',
  template: `
    <div class="dialog-backdrop fixed inset-0 flex items-center justify-center bg-black/40 p-3"
         animate.enter="anim-fade-in" animate.leave="anim-fade-out" (click)="closed.emit()">
      <section animate.enter="anim-dialog-in" animate.leave="anim-dialog-out"
               class="w-full max-w-lg rounded-2xl bg-gray-100 text-indigo-950 shadow-2xl p-4 flex flex-col gap-3"
               (click)="$event.stopPropagation()">
        <h2 class="font-semibold text-xl">Erinnerungen</h2>
        <p class="text-sm">
          Die Erinnerung wählst du pro Termin im Terminformular. Hier legst du fest, ob ForTwo dich auf
          <b>diesem Gerät</b> per Mitteilung erinnert.
        </p>
        <p class="text-sm">
          Hast du ForTwo als Abo im Handy-Kalender (iPhone oder ICSx⁵), erinnert dich schon der Handy-Kalender.
          Lass die Mitteilungen dort aus, sonst kommt jede Erinnerung doppelt. Beim Abo über Google Kalender
          gibt es keine Erinnerungen, dann hier einschalten.
        </p>

        @if (!push.supported) {
          <p class="p-2 rounded bg-amber-100 text-amber-900 text-sm">
            Auf diesem Gerät sind Mitteilungen nicht möglich. Auf dem iPhone zuerst ForTwo in Safari über
            Teilen → „Zum Home-Bildschirm“ hinzufügen und von dort öffnen.
          </p>
        } @else if (loading()) {
          <p class="text-sm">Lädt …</p>
        } @else {
          <label class="flex items-center justify-between gap-3 p-3 rounded-lg bg-white">
            <span>Erinnerungen auf diesem Gerät</span>
            <input type="checkbox" class="size-5 accent-indigo-600" [checked]="on()" [disabled]="busy()" (change)="toggle($any($event.target))" />
          </label>
          @if (push.blocked) {
            <p class="text-xs text-red-800">Mitteilungen sind für ForTwo blockiert. Erlaube sie in den Einstellungen des Browsers bzw. Handys.</p>
          }
        }

        @if (errorText()) {
          <p class="p-2 rounded bg-red-200 text-red-900 text-sm">{{ errorText() }}</p>
        }
        <div class="flex justify-end">
          <button class="px-4 py-2 rounded-lg shadow bg-indigo-600 hover:bg-fuchsia-500 text-white" (click)="closed.emit()">Fertig</button>
        </div>
      </section>
    </div>
  `,
})
export class ReminderDialog {
  readonly closed = output<void>();
  readonly loading = signal(true);
  readonly on = signal(false);
  readonly busy = signal(false);
  readonly errorText = signal('');

  constructor(public push: PushReminders) {
    this.push.isOn().then(
      (on) => this.on.set(on),
      (error) => this.errorText.set(errorMessage(error))
    ).finally(() => this.loading.set(false));
  }

  async toggle(box: HTMLInputElement) {
    const on = box.checked;
    this.busy.set(true);
    this.errorText.set('');
    try {
      if (on) await this.push.enable();
      else await this.push.disable();
      this.on.set(on);
    } catch (error) {
      this.on.set(!on);
      box.checked = !on; // the binding does not reset the box when the value stays the same
      this.errorText.set(this.push.blocked ? 'Mitteilungen wurden nicht erlaubt.' : errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
