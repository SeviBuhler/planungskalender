import { Component, computed, input, output, signal } from '@angular/core';
import { CalendarStore } from '../../features/calendar/calendar-store';
import { FUTURE_YEARS, ImportResult, parseIcs } from '../../features/calendar/ics-import';
import { CsvFormatError, parseCsv } from '../../features/calendar/csv-import';
import { Select, SelectOption } from '../../components/select/select';

function errorMessage(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: string }).message)
    : 'Unbekannter Fehler';
}

// Calendar exports are a few MB at most; larger files would only freeze the browser
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const formatDate = (d: Date) => d.toLocaleDateString('de-CH', { day: 'numeric', month: 'short', year: 'numeric' });

// Imports .ics (Google, Apple, Outlook) and .csv files into the private calendar or a household
@Component({
  selector: 'app-import-dialog',
  imports: [Select],
  template: `
    <div class="fixed inset-0 z-10 flex items-end sm:items-center justify-center bg-black/40 p-3"
         animate.enter="anim-fade-in" animate.leave="anim-fade-out" (click)="close()">
      <section animate.enter="anim-dialog-in" animate.leave="anim-dialog-out"
               class="w-full max-w-lg rounded-2xl bg-gray-100 text-indigo-950 shadow-2xl p-4 flex flex-col gap-3 max-h-[90vh] overflow-y-auto"
               (click)="$event.stopPropagation()">
        <h2 class="font-semibold text-xl">Kalender importieren</h2>

        @if (done() === null) {
          <p class="text-sm">
            Wähle eine oder mehrere Dateien im Format <b>.ics</b> (Google, Apple, Outlook) oder <b>.csv</b> (Outlook).
            Wiederkehrende Termine werden als Serie übernommen. Importierst du dieselbe Datei nochmals, werden die Termine
            aktualisiert statt doppelt angelegt.
          </p>
          <label class="px-4 py-2 rounded-lg shadow bg-gray-200 hover:bg-fuchsia-100 text-center cursor-pointer">
            {{ fileNames() || 'Datei auswählen' }}
            <input class="sr-only" type="file" multiple accept=".ics,.ical,.ifb,.icalendar,.csv,text/calendar,text/csv"
                   (change)="onFiles($event)" />
          </label>
          <details class="text-sm">
            <summary class="cursor-pointer font-semibold">Wo finde ich die Datei?</summary>
            <ul class="mt-2 flex flex-col gap-2 list-disc pl-5">
              <li><b>Google Kalender:</b> Am Computer auf calendar.google.com → Einstellungen → „Importieren und exportieren“ →
                „Exportieren“. Die ZIP-Datei entpacken und die .ics-Dateien hier auswählen.</li>
              <li><b>Apple / iCloud:</b> Am Mac in der App Kalender den Kalender wählen → Ablage → Exportieren. Auf dem iPhone geht
                das nicht direkt, dort auf icloud.com den Kalender öffentlich teilen und den Link im Browser öffnen, um die .ics zu laden.</li>
              <li><b>Outlook:</b> Datei → „Kalender speichern“ (.ics) oder Datei → Öffnen und exportieren → Importieren/Exportieren → in Datei exportieren (.csv).</li>
            </ul>
          </details>

          @if (result(); as r) {
            <div class="p-3 rounded-lg bg-white text-sm flex flex-col gap-1">
              @if (r.events.length) {
                <p><b>{{ r.events.length }} Termine</b> gefunden@if (seriesCount()) {, davon {{ seriesCount() }} Serien}.</p>
                <p>{{ range() }}</p>
              } @else {
                <p><b>Keine Termine</b> in der Datei gefunden.</p>
              }
              @if (r.skipped) {
                <p class="text-gray-600">{{ r.skipped }} übersprungen (abgesagt, ohne Datum oder vor mehr als 5 Jahren).</p>
              }
              @if (r.truncatedSeries) {
                <p class="text-gray-600">{{ r.truncatedSeries }} Serien ohne Ende werden bis {{ futureYears }} Jahre im Voraus übernommen.</p>
              }
              @if (r.unknownZones.length) {
                <p class="text-amber-800">Unbekannte Zeitzone {{ r.unknownZones.join(', ') }}: diese Zeiten werden als Ortszeit gelesen.</p>
              }
            </div>
            @if (r.events.length) {
              <label class="text-sm">Importieren in
                <app-select class="mt-1" ariaLabel="Importieren in" [options]="targets()" [value]="target()" (valueChange)="target.set($event)" />
              </label>
            }
          }

          @if (busy() && progress() !== null) {
            <p class="text-sm">Importiere … {{ progress() }} von {{ result()?.events?.length }}</p>
          }

          <div class="flex flex-wrap gap-2 justify-end">
            <button class="px-4 py-2 rounded-lg hover:bg-gray-300" (click)="close()">Abbrechen</button>
            <button class="px-4 py-2 rounded-lg shadow bg-indigo-600 hover:bg-fuchsia-500 text-white disabled:opacity-50"
                    [disabled]="busy() || !result()?.events?.length" (click)="import()">Importieren</button>
          </div>
        } @else {
          <p class="p-3 rounded-lg bg-emerald-100 text-emerald-950">{{ done() }} Termine importiert.</p>
          <div class="flex justify-end">
            <button class="px-4 py-2 rounded-lg shadow bg-indigo-600 hover:bg-fuchsia-500 text-white" (click)="close()">Fertig</button>
          </div>
        }

        @if (errorText()) {
          <p class="p-2 rounded bg-red-200 text-red-900 text-sm">{{ errorText() }}</p>
        }
      </section>
    </div>
  `,
})
export class ImportDialog {
  readonly targets = input.required<SelectOption[]>();
  readonly closed = output<boolean>(); // true when events were imported
  readonly futureYears = FUTURE_YEARS;
  readonly result = signal<ImportResult | null>(null);
  readonly fileNames = signal('');
  readonly target = signal('private');
  readonly busy = signal(false);
  readonly progress = signal<number | null>(null);
  readonly done = signal<number | null>(null);
  readonly errorText = signal('');
  readonly seriesCount = computed(() => new Set(this.result()?.events.map((e) => e.seriesKey).filter(Boolean)).size);
  readonly range = computed(() => {
    const events = this.result()?.events ?? [];
    if (!events.length) return '';
    const first = events[0].start;
    const last = events.reduce((max, e) => (e.start > max ? e.start : max), first);
    return first.toDateString() === last.toDateString() ? `Am ${formatDate(first)}` : `Vom ${formatDate(first)} bis ${formatDate(last)}`;
  });

  constructor(private store: CalendarStore) {}

  async onFiles(event: Event) {
    const files = Array.from((event.target as HTMLInputElement).files ?? []);
    this.errorText.set('');
    this.result.set(null);
    this.fileNames.set(files.map((f) => f.name).join(', '));
    if (!files.length) return;
    try {
      const results: ImportResult[] = [];
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) throw new CsvFormatError(`„${file.name}“ ist grösser als 10 MB.`);
        const text = await file.text();
        const isIcs = /BEGIN:VCALENDAR/i.test(text.slice(0, 2000));
        if (!isIcs && !/\.csv$/i.test(file.name) && !text.includes(',') && !text.includes(';')) {
          throw new CsvFormatError(`„${file.name}“ ist weder eine .ics- noch eine .csv-Datei.`);
        }
        results.push(isIcs ? parseIcs(text) : parseCsv(text));
      }
      // The same event in two files is imported once
      const events = new Map(results.flatMap((r) => r.events).map((e) => [e.key, e]));
      this.result.set({
        events: [...events.values()].sort((a, b) => a.start.getTime() - b.start.getTime()),
        skipped: results.reduce((sum, r) => sum + r.skipped, 0),
        truncatedSeries: results.reduce((sum, r) => sum + r.truncatedSeries, 0),
        unknownZones: [...new Set(results.flatMap((r) => r.unknownZones))],
      });
    } catch (error) {
      this.errorText.set(error instanceof CsvFormatError ? error.message : `Datei konnte nicht gelesen werden: ${errorMessage(error)}`);
    }
  }

  async import() {
    const result = this.result();
    if (!result?.events.length || this.busy()) return;
    this.busy.set(true);
    this.errorText.set('');
    this.progress.set(0);
    try {
      const target = this.target();
      await this.store.importEvents(result.events, target === 'private' ? null : target, (done) => this.progress.set(done));
      this.done.set(result.events.length);
    } catch (error) {
      this.errorText.set(errorMessage(error));
    } finally {
      this.busy.set(false);
      this.progress.set(null);
    }
  }

  close() {
    if (this.busy()) return;
    this.closed.emit(this.done() !== null);
  }
}
