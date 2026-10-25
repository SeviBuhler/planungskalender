import { Component, OnDestroy, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MonthBudget, NOVEMBER_2026, allocate, carryOver, expenseTotal, nextMonth } from '../../features/finance/allocate';
import { BudgetStore, Household } from '../../features/finance/budget-store';

type ListKey = 'expenses' | 'debts' | 'savings';
type ViewState = 'loading' | 'setup' | 'ready' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const SAVE_DELAY_MS = 600;

function previousMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(year, m - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)
    ? String((error as { message: string }).message)
    : 'Unbekannter Fehler';
}

@Component({
  selector: 'app-finance',
  imports: [FormsModule, RouterLink],
  templateUrl: './finance.html',
  styleUrl: './finance.css',
})
export class Finance implements OnDestroy {
  readonly state = signal<ViewState>('loading');
  readonly saveState = signal<SaveState>('idle');
  readonly errorText = signal('');
  readonly household = signal<Household | null>(null);
  inviteCode = '';

  readonly budget = signal<MonthBudget>(structuredClone(NOVEMBER_2026));
  readonly result = computed(() => allocate(this.budget()));
  readonly expenseTotal = expenseTotal;

  readonly monthLabel = computed(() => {
    const [year, m] = this.budget().month.split('-').map(Number);
    return new Date(year, m - 1, 1).toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });
  });

  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private loadToken = 0;

  constructor(private store: BudgetStore) {
    this.init();
  }

  ngOnDestroy() {
    this.flushSave();
  }

  chf(value: number): string {
    return value.toLocaleString('de-CH', { maximumFractionDigits: 2 });
  }

  private async init() {
    try {
      const household = await this.store.loadHousehold();
      if (!household) {
        this.state.set('setup');
        return;
      }
      await this.useHousehold(household);
    } catch (error) {
      this.fail(error);
    }
  }

  private async useHousehold(household: Household) {
    this.household.set(household);
    // The plan starts with November 2026, the first month taken over from the Excel file
    const month = currentMonth() < NOVEMBER_2026.month ? NOVEMBER_2026.month : currentMonth();
    await this.openMonth(month);
  }

  async createHousehold() {
    await this.runSetup(() => this.store.createHousehold());
  }

  async joinHousehold() {
    if (!this.inviteCode.trim()) return;
    await this.runSetup(() => this.store.joinHousehold(this.inviteCode));
  }

  private async runSetup(action: () => Promise<Household>) {
    this.errorText.set('');
    try {
      await this.useHousehold(await action());
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }

  async openMonth(month: string) {
    const household = this.household();
    if (!household) return;
    await this.flushSave();
    const token = ++this.loadToken;
    if (this.state() !== 'ready') this.state.set('loading');

    try {
      const budget = await this.findBudget(household.id, month);
      if (token !== this.loadToken) return; // a newer month was opened meanwhile
      this.budget.set(budget);
      this.saveState.set('idle');
      this.state.set('ready');
    } catch (error) {
      if (token === this.loadToken) this.fail(error);
    }
  }

  private async findBudget(householdId: string, month: string): Promise<MonthBudget> {
    const stored = await this.store.load(householdId, month);
    if (stored) return stored;

    // Take over a plan that was saved in this browser before, so nothing gets lost
    const legacy = this.store.loadLegacy(month);
    if (legacy) {
      await this.store.save(householdId, legacy);
      this.store.removeLegacy(month);
      return legacy;
    }

    // No plan yet: carry over from the previous month if there is one
    const previous = (await this.store.load(householdId, previousMonth(month))) ?? this.store.loadLegacy(previousMonth(month));
    if (previous) return { ...carryOver(previous), month };
    if (month === NOVEMBER_2026.month) return structuredClone(NOVEMBER_2026);
    return { month, startBalance: 0, income: 0, expenses: [], debts: [], savings: [] };
  }

  goToPreviousMonth() {
    this.openMonth(previousMonth(this.budget().month));
  }

  goToNextMonth() {
    this.openMonth(nextMonth(this.budget().month));
  }

  private edit(change: (budget: MonthBudget) => MonthBudget) {
    this.budget.update(change);
    this.saveState.set('saving');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DELAY_MS);
  }

  private async flushSave() {
    if (this.saveTimer === undefined) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const household = this.household();
    if (!household) return;
    try {
      await this.store.save(household.id, this.budget());
      this.saveState.set('saved');
    } catch (error) {
      this.saveState.set('error');
      this.errorText.set(errorMessage(error));
    }
  }

  private fail(error: unknown) {
    this.errorText.set(errorMessage(error));
    this.state.set('error');
  }

  setField(field: 'startBalance' | 'income', value: number) {
    this.edit((b) => ({ ...b, [field]: Number(value) || 0 }));
  }

  setItem(list: ListKey, index: number, field: string, value: string | number) {
    this.edit((b) => {
      const items = b[list].map((item, i) =>
        i === index ? { ...item, [field]: field === 'name' || field === 'note' ? value : Number(value) || 0 } : item
      );
      return { ...b, [list]: items };
    });
  }

  addItem(list: ListKey) {
    const blank = {
      expenses: { name: '', amountPerUnit: 0, quantity: 1 },
      debts: { name: '', open: 0 },
      savings: { name: '', target: 0, desiredRate: 0 },
    }[list];
    this.edit((b) => ({ ...b, [list]: [...b[list], blank] }));
  }

  removeItem(list: ListKey, index: number) {
    this.edit((b) => ({ ...b, [list]: b[list].filter((_, i) => i !== index) }));
  }

  // Moves an entry up in the priority order (debts and savings are paid top to bottom)
  moveUp(list: 'debts' | 'savings', index: number) {
    if (index === 0) return;
    this.edit((b) => {
      const items = [...b[list]];
      [items[index - 1], items[index]] = [items[index], items[index - 1]];
      return { ...b, [list]: items };
    });
  }
}
