import { Component, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MonthBudget, NOVEMBER_2026, allocate, carryOver, expenseTotal } from '../../features/finance/allocate';
import { BudgetStore } from '../../features/finance/budget-store';

type ListKey = 'expenses' | 'debts' | 'savings';

function previousMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(year, m - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

@Component({
  selector: 'app-finance',
  imports: [FormsModule, RouterLink],
  templateUrl: './finance.html',
  styleUrl: './finance.css',
})
export class Finance {
  readonly budget = signal<MonthBudget>(structuredClone(NOVEMBER_2026));
  readonly result = computed(() => allocate(this.budget()));
  readonly expenseTotal = expenseTotal;

  chf(value: number): string {
    return value.toLocaleString('de-CH', { maximumFractionDigits: 2 });
  }

  readonly monthLabel = computed(() => {
    const [year, m] = this.budget().month.split('-').map(Number);
    return new Date(year, m - 1, 1).toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });
  });

  constructor(private store: BudgetStore) {
    this.openMonth(NOVEMBER_2026.month);
    effect(() => this.store.save(this.budget()));
  }

  openMonth(month: string) {
    const stored = this.store.load(month);
    if (stored) {
      this.budget.set(stored);
      return;
    }
    // No plan yet: carry over from the previous month if there is one
    const previous = this.store.load(previousMonth(month));
    this.budget.set(previous ? { ...carryOver(previous), month } : { month, startBalance: 0, income: 0, expenses: [], debts: [], savings: [] });
  }

  goToPreviousMonth() {
    this.openMonth(previousMonth(this.budget().month));
  }

  goToNextMonth() {
    const current = this.budget();
    const next = carryOver(current).month;
    this.openMonth(next);
  }

  setField(field: 'startBalance' | 'income', value: number) {
    this.budget.update((b) => ({ ...b, [field]: Number(value) || 0 }));
  }

  setItem(list: ListKey, index: number, field: string, value: string | number) {
    this.budget.update((b) => {
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
    this.budget.update((b) => ({ ...b, [list]: [...b[list], blank] }));
  }

  removeItem(list: ListKey, index: number) {
    this.budget.update((b) => ({ ...b, [list]: b[list].filter((_, i) => i !== index) }));
  }

  // Moves an entry up in the priority order (debts and savings are paid top to bottom)
  moveUp(list: 'debts' | 'savings', index: number) {
    if (index === 0) return;
    this.budget.update((b) => {
      const items = [...b[list]];
      [items[index - 1], items[index]] = [items[index], items[index - 1]];
      return { ...b, [list]: items };
    });
  }
}
