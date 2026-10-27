import { Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { MonthBudget } from '../../features/finance/allocate';
import { BudgetStore, FinancePlan } from '../../features/finance/budget-store';
import { SummaryPeriod, monthName, periodLabel, periodRange, summarize } from '../../features/finance/summary';
import { ExportInfo, download, fileName, summaryPdf, summaryXlsx } from '../../features/finance/summary-export';

type LoadState = 'loading' | 'ready' | 'error';

function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(year, m - 1 + by, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const CARD = 'rounded-lg bg-gray-100 dark:bg-gray-200 text-indigo-950 shadow p-4';
const BUTTON = 'px-3 py-2 rounded-lg shadow bg-indigo-600 dark:bg-indigo-700 hover:bg-fuchsia-500 text-white disabled:opacity-50';

// Month or year summary of one plan, shown in the app and exportable as Excel or PDF.
// It reads the plan's months through the store, so the plan's visibility (RLS) applies as everywhere else.
@Component({
  selector: 'app-finance-summary',
  template: `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <div class="flex rounded-lg shadow overflow-hidden" role="group" aria-label="Zeitraum">
        <button class="px-3 py-2" [class]="period().kind === 'month' ? 'bg-fuchsia-600 text-white' : 'bg-gray-100 text-indigo-800'" (click)="setKind('month')">Monat</button>
        <button class="px-3 py-2" [class]="period().kind === 'year' ? 'bg-fuchsia-600 text-white' : 'bg-gray-100 text-indigo-800'" (click)="setKind('year')">Jahr</button>
      </div>
      <button [class]="button" (click)="shift(-1)" aria-label="Vorheriger Zeitraum">‹</button>
      <h2 class="text-xl font-semibold capitalize min-w-36 text-center">{{ label() }}</h2>
      <button [class]="button" (click)="shift(1)" aria-label="Nächster Zeitraum">›</button>
      <div class="flex gap-2 ml-auto">
        <button [class]="button" [disabled]="!canExport()" (click)="exportXlsx()">Excel</button>
        <button [class]="button" [disabled]="!canExport()" (click)="exportPdf()">{{ exporting() ? 'PDF…' : 'PDF' }}</button>
        <button class="px-3 py-2 rounded-lg shadow bg-gray-100 text-indigo-800 hover:bg-fuchsia-100" (click)="close.emit()">Zurück</button>
      </div>
    </div>
    @if (exportError()) {
      <p class="mb-4 p-2 rounded bg-red-200 text-red-900 text-sm">{{ exportError() }}</p>
    }

    @switch (state()) {
      @case ('loading') { <p class="text-center mt-8">Lade…</p> }
      @case ('error') { <p class="p-3 rounded bg-red-200 text-red-900">Zusammenfassung konnte nicht geladen werden: {{ errorText() }}</p> }
      @case ('ready') {
        @if (summary().months.length === 0) {
          <p [class]="card">Für {{ label() }} sind noch keine Monate gespeichert.</p>
        } @else {
          @let s = summary();
          @if (s.uncoveredMonths.length) {
            <p class="mb-4 p-2 rounded bg-red-200 text-red-900 font-semibold">Ausgaben nicht gedeckt im {{ monthList(s.uncoveredMonths) }}</p>
          }
          <div class="grid gap-4 lg:grid-cols-3">
            <section [class]="card + ' h-fit'">
              <h3 class="font-semibold text-lg mb-3">Übersicht</h3>
              <dl class="grid grid-cols-2 gap-y-2 text-sm">
                <dt>Startguthaben</dt><dd class="text-right">{{ chf(s.startBalance) }}</dd>
                <dt>Einnahmen</dt><dd class="text-right">+ {{ chf(s.income) }}</dd>
                <dt>Ausgaben</dt><dd class="text-right">− {{ chf(s.plannedTotal) }}</dd>
                <dt>Schuldenzahlungen</dt><dd class="text-right">− {{ chf(s.debtTotal) }}</dd>
                <dt>Sparraten</dt><dd class="text-right">− {{ chf(s.savingsTotal) }}</dd>
                <dt class="font-semibold border-t border-gray-400 pt-2">Kontostand Ende</dt>
                <dd class="font-semibold text-right border-t border-gray-400 pt-2">{{ chf(s.endBalance) }} CHF</dd>
                <dt>Restschulden</dt><dd class="text-right">{{ chf(s.remainingDebt) }}</dd>
              </dl>
              @if (s.period.kind === 'year') {
                <p class="mt-3 text-xs">{{ s.months.length }} von 12 Monaten gespeichert. Monate ohne gespeicherte Daten zählen nicht mit.</p>
              }
            </section>

            <div class="lg:col-span-2 flex flex-col gap-4">
              @if (s.period.kind === 'year') {
                <section [class]="card">
                  <h3 class="font-semibold text-lg mb-3">Monate</h3>
                  <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                      <thead><tr class="text-xs text-left">
                        <th class="py-1">Monat</th><th class="text-right">Einnahmen</th><th class="text-right">Ausgaben</th><th class="text-right">Schulden</th><th class="text-right">Sparen</th><th class="text-right">Ende</th>
                      </tr></thead>
                      <tbody>
                        @for (m of s.months; track m.month) {
                          <tr class="border-t border-gray-300" [class.text-red-700]="!m.plannedCovered">
                            <td class="py-1 pr-2 capitalize">{{ monthName(m.month) }}</td>
                            <td class="text-right">{{ chf(m.income) }}</td><td class="text-right">{{ chf(m.plannedTotal) }}</td>
                            <td class="text-right">{{ chf(m.debtTotal) }}</td><td class="text-right">{{ chf(m.savingsTotal) }}</td>
                            <td class="text-right">{{ chf(m.endBalance) }}</td>
                          </tr>
                        }
                      </tbody>
                      <tfoot><tr class="border-t-2 border-gray-400 font-semibold">
                        <td class="py-1">Total</td><td class="text-right">{{ chf(s.income) }}</td><td class="text-right">{{ chf(s.plannedTotal) }}</td>
                        <td class="text-right">{{ chf(s.debtTotal) }}</td><td class="text-right">{{ chf(s.savingsTotal) }}</td><td></td>
                      </tr></tfoot>
                    </table>
                  </div>
                </section>
              }

              <section [class]="card">
                <h3 class="font-semibold text-lg mb-3">Schulden & Sparen</h3>
                @for (p of s.priorities; track p.kind + p.name) {
                  <div class="mb-3">
                    <div class="flex justify-between gap-2 text-sm">
                      <span><span class="px-1 rounded text-xs font-semibold" [class]="p.kind === 'debt' ? 'bg-rose-200 text-rose-900' : 'bg-emerald-200 text-emerald-900'">{{ p.kind === 'debt' ? 'Schuld' : 'Sparen' }}</span> {{ p.name }}</span>
                      <span>bezahlt <b>{{ chf(p.paid) }}</b> · Rest {{ chf(p.remaining) }}</span>
                    </div>
                    <div class="mt-1 h-2 rounded bg-gray-300 overflow-hidden">
                      <div class="h-full" [class]="p.kind === 'debt' ? 'bg-rose-500' : 'bg-emerald-500'" [style.width.%]="progress(p.paid, p.startAmount)"></div>
                    </div>
                  </div>
                } @empty {
                  <p class="text-sm">Keine Schulden oder Sparziele.</p>
                }
              </section>

              <section [class]="card">
                <h3 class="font-semibold text-lg mb-3">Ausgaben</h3>
                <table class="w-full text-sm">
                  <tbody>
                    @for (e of s.expenses; track e.name) {
                      <tr class="border-t border-gray-300 first:border-t-0">
                        <td class="py-1">{{ e.name }}</td>
                        @if (s.period.kind === 'year') { <td class="text-right text-xs">{{ e.months }}×</td> }
                        <td class="text-right">{{ chf(e.total) }}</td>
                      </tr>
                    } @empty {
                      <tr><td>Keine Ausgaben.</td></tr>
                    }
                  </tbody>
                </table>
              </section>
            </div>
          </div>
        }
      }
    }
  `,
})
export class FinanceSummary {
  readonly plan = input.required<FinancePlan>();
  readonly visibility = input.required<string>();
  readonly startMonth = input.required<string>();
  readonly close = output<void>();

  readonly card = CARD;
  readonly button = BUTTON;
  readonly monthName = monthName;

  readonly state = signal<LoadState>('loading');
  readonly errorText = signal('');
  readonly exporting = signal(false);
  readonly exportError = signal('');
  readonly period = signal<SummaryPeriod>({ kind: 'month', month: '' });
  private readonly budgets = signal<MonthBudget[]>([]);
  // Months of one whole year are loaded at once; month and year view are computed from them
  private loadedYear: number | null = null;
  private loadToken = 0;

  readonly summary = computed(() => summarize(this.period(), this.budgets()));
  readonly label = computed(() => periodLabel(this.period()));
  readonly canExport = computed(() => this.state() === 'ready' && this.summary().months.length > 0 && !this.exporting());

  constructor(private store: BudgetStore) {
    // Opens on the month shown in the editor; switching the plan keeps the period and reloads
    effect(() => {
      this.plan();
      untracked(() => {
        const period = this.period();
        this.loadedYear = null;
        this.setPeriod(period.kind === 'month' && !period.month ? { kind: 'month', month: this.startMonth() } : period);
      });
    });
  }

  chf(value: number): string {
    return value.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  progress(paid: number, start: number): number {
    return start > 0 ? Math.min(100, (paid / start) * 100) : 100;
  }

  monthList(months: string[]): string {
    return months.map(monthName).join(', ');
  }

  private year(period: SummaryPeriod): number {
    return period.kind === 'year' ? period.year : Number(period.month.slice(0, 4));
  }

  setKind(kind: 'month' | 'year') {
    const current = this.period();
    if (current.kind === kind) return;
    const year = this.year(current);
    if (kind === 'year') {
      this.setPeriod({ kind: 'year', year });
      return;
    }
    // Back to the month view: the current month in the current year, otherwise January
    const now = new Date();
    const month = year === now.getFullYear() ? now.getMonth() + 1 : 1;
    this.setPeriod({ kind: 'month', month: `${year}-${String(month).padStart(2, '0')}` });
  }

  shift(by: -1 | 1) {
    const current = this.period();
    this.setPeriod(current.kind === 'year' ? { kind: 'year', year: current.year + by } : { kind: 'month', month: shiftMonth(current.month, by) });
  }

  private async setPeriod(period: SummaryPeriod) {
    this.period.set(period);
    const year = this.year(period);
    if (year === this.loadedYear) return;
    const token = ++this.loadToken;
    this.state.set('loading');
    try {
      const { from, to } = periodRange({ kind: 'year', year });
      const budgets = await this.store.loadRange(this.plan().id, from, to);
      if (token !== this.loadToken) return;
      this.budgets.set(budgets);
      this.loadedYear = year;
      this.state.set('ready');
    } catch (error) {
      if (token !== this.loadToken) return;
      this.errorText.set(error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error));
      this.state.set('error');
    }
  }

  private info(): ExportInfo {
    return { planName: this.plan().name, visibility: this.visibility() };
  }

  exportXlsx() {
    const summary = this.summary();
    download(summaryXlsx(summary, this.info()), fileName(summary, this.info(), 'xlsx'));
  }

  async exportPdf() {
    const summary = this.summary();
    this.exporting.set(true);
    this.exportError.set('');
    try {
      download(await summaryPdf(summary, this.info()), fileName(summary, this.info(), 'pdf'));
    } catch (error) {
      this.exportError.set(`PDF konnte nicht erstellt werden: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.exporting.set(false);
    }
  }
}
