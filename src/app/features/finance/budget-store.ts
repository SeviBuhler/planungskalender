import { Injectable } from '@angular/core';
import { MonthBudget, NOVEMBER_2026 } from './allocate';

const KEY_PREFIX = 'finance:';

// Keeps budgets in the browser for now; can later move to a Supabase table
@Injectable({
  providedIn: 'root'
})
export class BudgetStore {
  load(month: string): MonthBudget | null {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + month);
      if (raw) {
        return JSON.parse(raw) as MonthBudget;
      }
    } catch {
      // storage unavailable or corrupt entry: fall through to the default
    }
    return month === NOVEMBER_2026.month ? structuredClone(NOVEMBER_2026) : null;
  }

  save(budget: MonthBudget) {
    try {
      localStorage.setItem(KEY_PREFIX + budget.month, JSON.stringify(budget));
    } catch {
      // storage unavailable (e.g. private mode): keep working in memory
    }
  }
}
