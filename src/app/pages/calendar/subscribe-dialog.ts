import { Component, computed, output, signal } from '@angular/core';
import { CalendarFeedStore, feedUrl, webcalUrl } from '../../features/calendar/calendar-feed';
import { ConfirmService } from '../../components/confirm/confirm';

function errorMessage(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: string }).message)
    : 'Unbekannter Fehler';
}

// Shows the secret subscription link so the phone calendar (and its home screen widget)
// displays the ForTwo events
@Component({
  selector: 'app-subscribe-dialog',
  template: `
    <div class="dialog-backdrop fixed inset-0 flex items-center justify-center bg-black/40 p-3"
         animate.enter="anim-fade-in" animate.leave="anim-fade-out" (click)="closed.emit()">
      <section animate.enter="anim-dialog-in" animate.leave="anim-dialog-out"
               class="w-full max-w-lg rounded-2xl bg-gray-100 text-indigo-950 shadow-2xl p-4 flex flex-col gap-3"
               (click)="$event.stopPropagation()">
        <h2 class="font-semibold text-xl">Mit Handy-Kalender verbinden</h2>
        <p class="text-sm">
          Abonniere ForTwo in deinem Kalender (iPhone, Google, Outlook). Deine privaten Termine und die deiner Haushalte
          erscheinen dann dort und im Kalender-Widget auf dem Homescreen. Ändern kannst du sie weiterhin hier in ForTwo.
        </p>

        @if (loading()) {
          <p class="text-sm">Lädt …</p>
        } @else if (token(); as t) {
          <a class="px-4 py-2 rounded-lg shadow bg-indigo-600 hover:bg-fuchsia-500 text-white text-center" [href]="webcal()">
            Im Kalender abonnieren
          </a>
          <div class="flex gap-2">
            <input class="flex-1 min-w-0 p-2 rounded bg-white text-xs" readonly [value]="link()" aria-label="Abo-Link"
                   (focus)="$any($event.target).select()" />
            <button class="px-3 py-2 rounded-lg shadow bg-gray-200 hover:bg-fuchsia-100" (click)="copy()">
              {{ copied() ? 'Kopiert' : 'Kopieren' }}
            </button>
          </div>
          <details class="text-sm">
            <summary class="cursor-pointer font-semibold">So geht's</summary>
            <ul class="mt-2 flex flex-col gap-2 list-disc pl-5">
              <li><b>iPhone:</b> „Im Kalender abonnieren“ tippen und „Abonnieren“ bestätigen. Oder Einstellungen → Kalender →
                Accounts → Account hinzufügen → Andere → Kalenderabo hinzufügen und den Link einfügen.</li>
              <li><b>Android / Google Kalender:</b> Am Computer auf calendar.google.com → „Weitere Kalender“ + → „Per URL“ und den
                Link einfügen. Danach erscheint er auch in der Google-Kalender-App auf dem Handy.</li>
              <li><b>Outlook:</b> Kalender hinzufügen → „Aus dem Internet abonnieren“ und den Link einfügen.</li>
            </ul>
            <p class="mt-2">Neue Termine erscheinen je nach Kalender nach einigen Minuten bis Stunden (Google aktualisiert am langsamsten).</p>
          </details>
          <p class="text-xs">
            Deine Termine sind verschlüsselt, deshalb heisst im Abo jeder Termin nur „Termin“. Titel zeigen kannst du unter
            Optionen → Verschlüsselung einschalten.
          </p>
          <p class="text-xs text-red-800">Wer den Link kennt, sieht deine Termine. Teile ihn nicht. Erneuern macht den alten Link ungültig.</p>
          <div class="flex flex-wrap gap-2 justify-end">
            <button class="mr-auto px-4 py-2 rounded-lg text-red-700 hover:bg-red-100" (click)="remove()">Link löschen</button>
            <button class="px-4 py-2 rounded-lg hover:bg-gray-300" (click)="renew(true)">Link erneuern</button>
            <button class="px-4 py-2 rounded-lg shadow bg-indigo-600 hover:bg-fuchsia-500 text-white" (click)="closed.emit()">Fertig</button>
          </div>
        } @else {
          <div class="flex flex-wrap gap-2 justify-end">
            <button class="px-4 py-2 rounded-lg hover:bg-gray-300" (click)="closed.emit()">Abbrechen</button>
            <button class="px-4 py-2 rounded-lg shadow bg-indigo-600 hover:bg-fuchsia-500 text-white" (click)="renew(false)">Abo-Link erstellen</button>
          </div>
        }

        @if (errorText()) {
          <p class="p-2 rounded bg-red-200 text-red-900 text-sm">{{ errorText() }}</p>
        }
      </section>
    </div>
  `,
})
export class SubscribeDialog {
  readonly closed = output<void>();
  readonly loading = signal(true);
  readonly token = signal<string | null>(null);
  readonly copied = signal(false);
  readonly errorText = signal('');
  readonly link = computed(() => (this.token() ? feedUrl(this.token()!) : ''));
  readonly webcal = computed(() => (this.token() ? webcalUrl(this.token()!) : ''));

  constructor(private store: CalendarFeedStore, private confirm: ConfirmService) {
    this.store.token().then(
      (token) => this.token.set(token),
      (error) => this.errorText.set(errorMessage(error))
    ).finally(() => this.loading.set(false));
  }

  async renew(ask: boolean) {
    if (ask && !(await this.confirm.ask('Der alte Link funktioniert danach nicht mehr. Kalender, die ihn abonniert haben, musst du neu verbinden.', 'Erneuern'))) return;
    this.errorText.set('');
    try {
      this.token.set(await this.store.renew());
      this.copied.set(false);
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }

  async remove() {
    if (!(await this.confirm.ask('Abonnierte Kalender zeigen danach keine ForTwo-Termine mehr.', 'Löschen'))) return;
    this.errorText.set('');
    try {
      await this.store.remove();
      this.token.set(null);
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }

  async copy() {
    try {
      await navigator.clipboard.writeText(this.link());
      this.copied.set(true);
    } catch {
      this.errorText.set('Kopieren nicht möglich, bitte den Link markieren und kopieren.');
    }
  }
}
