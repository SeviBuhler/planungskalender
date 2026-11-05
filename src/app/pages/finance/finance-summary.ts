import { Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { MonthBudget, resolveCarry } from '../../features/finance/allocate';
import { BudgetStore, FinancePlan } from '../../features/finance/budget-store';
import { SummaryPeriod, monthName, periodLabel, periodRange, summarize } from '../../features/finance/summary';
import { ExportInfo, download, fileName, summaryPdf, summaryXlsx } from '../../features/finance/summary-export';

type LoadState = 'loading' | 'ready' | 'error';

function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(year, m - 1 + by, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// "Monate" table: grid lines on every cell, sticky header row and month column
const GRID = 'border-b border-r border-gray-300 px-2 py-1.5 whitespace-nowrap';
const HEAD_CELL = `${GRID} sticky top-0 bg-gray-200 font-semibold`;
const FIRST_CELL = `${GRID} sticky left-0 z-10 text-left`;
const NUM_CELL = `${GRID} text-right`;
const FOOT_CELL = 'border-t-2 border-r border-gray-400 bg-gray-100 px-2 py-1.5 whitespace-nowrap';

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
                <dt>Übertrag</dt><dd class="text-right">{{ chf(s.startBalance) }}</dd>
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

            <div class="lg:col-span-2 min-w-0 flex flex-col gap-4">
              @if (s.period.kind === 'year') {
                <section [class]="card">
                  <h3 class="font-semibold text-lg mb-3">Monate <span class="text-xs font-normal opacity-60">in CHF</span></h3>
                  <!-- Header and month column stay in place while the table scrolls (sideways on phones) -->
                  <div class="max-h-[70vh] overflow-auto overscroll-contain rounded border border-gray-300 bg-white">
                    <table class="min-w-full border-separate border-spacing-0 text-sm tabular-nums">
                      <thead>
                        <tr class="text-xs">
                          <th [class]="headCell + ' left-0 z-30 text-left'">Monat</th>
                          @for (h of monthColumns; track h) {
                            <th [class]="headCell + ' z-20 text-right'">{{ h }}</th>
                          }
                        </tr>
                      </thead>
                      <tbody>
                        @for (m of s.months; track m.month; let odd = $odd) {
                          @let row = odd ? 'bg-gray-50' : 'bg-white';
                          <tr>
                            <td [class]="row + ' ' + firstCell + ' capitalize'" [class.text-red-700]="!m.plannedCovered" [title]="m.plannedCovered ? '' : 'Ausgaben nicht gedeckt'">{{ monthName(m.month) }}@if (!m.plannedCovered) { !}</td>
                            <td [class]="row + ' ' + numCell" [class.text-red-700]="m.startBalance < 0">{{ chf(m.startBalance) }}</td>
                            <td [class]="row + ' ' + numCell" [class.text-red-700]="m.income < 0">{{ chf(m.income) }}</td>
                            <td [class]="row + ' ' + numCell" [class.text-red-700]="m.plannedTotal < 0">{{ chf(m.plannedTotal) }}</td>
                            <td [class]="row + ' ' + numCell" [class.text-red-700]="m.debtTotal + m.savingsTotal < 0">{{ chf(m.debtTotal + m.savingsTotal) }}</td>
                            <td [class]="row + ' ' + numCell + ' font-semibold ' + balanceColor(m.endBalance)">{{ chf(m.endBalance) }}</td>
                          </tr>
                        }
                      </tbody>
                      <!-- The carry-over is not added up: January's carry-over is the starting wealth, the balance the end of December -->
                      <tfoot>
                        <tr class="font-bold">
                          <td [class]="footCell + ' sticky left-0 z-10 text-left'" title="Übertrag = Startvermögen, Saldo = Endstand">Total</td>
                          <td [class]="footCell + ' text-right'" [class.text-red-700]="s.startBalance < 0" title="Startvermögen">{{ chf(s.startBalance) }}</td>
                          <td [class]="footCell + ' text-right'" [class.text-red-700]="s.income < 0">{{ chf(s.income) }}</td>
                          <td [class]="footCell + ' text-right'" [class.text-red-700]="s.plannedTotal < 0">{{ chf(s.plannedTotal) }}</td>
                          <td [class]="footCell + ' text-right'" [class.text-red-700]="s.debtTotal + s.savingsTotal < 0">{{ chf(s.debtTotal + s.savingsTotal) }}</td>
                          <td [class]="footCell + ' text-right ' + balanceColor(s.endBalance)" title="Endstand">{{ chf(s.endBalance) }}</td>
                        </tr>
                      </tfoot>
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
  readonly monthColumns = ['Übertrag', 'Einnahmen', 'Ausgaben', 'Sparen/Schulden', 'Saldo'];
  readonly headCell = HEAD_CELL;
  readonly firstCell = FIRST_CELL;
  readonly numCell = NUM_CELL;
  readonly footCell = FOOT_CELL;

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

  balanceColor(value: number): string {
    return value < 0 ? 'text-red-700' : value > 0 ? 'text-green-700' : '';
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
      // All months up to the end of the year, because the carry-over runs through every month before
      const { to } = periodRange({ kind: 'year', year });
      const budgets = resolveCarry(await this.store.loadUntil(this.plan().id, to));
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
