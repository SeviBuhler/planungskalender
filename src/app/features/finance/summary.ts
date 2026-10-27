// Summaries over one month or one year of a plan: what came in, what went where,
// and how far each debt and savings goal got. Only months with saved data count.

import { MonthBudget, PriorityKind, allocate, expenseTotal } from './allocate';

export type SummaryPeriod = { kind: 'month'; month: string } | { kind: 'year'; year: number };

export interface SummaryMonth {
  month: string;
  startBalance: number;
  income: number;
  plannedTotal: number;
  debtTotal: number;
  savingsTotal: number;
  endBalance: number;
  plannedCovered: boolean;
}

export interface SummaryExpense {
  name: string;
  total: number;
  months: number; // in how many months the position appears
}

export interface SummaryPriority {
  kind: PriorityKind;
  name: string;
  startAmount: number; // open debt / remaining target when it first appears in the period
  paid: number;
  remaining: number; // after its last month in the period
}

export interface Summary {
  period: SummaryPeriod;
  months: SummaryMonth[];
  startBalance: number;
  income: number;
  plannedTotal: number;
  debtTotal: number;
  savingsTotal: number;
  endBalance: number;
  remainingDebt: number;
  uncoveredMonths: string[];
  expenses: SummaryExpense[];
  priorities: SummaryPriority[];
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

// First and last month (YYYY-MM) the period covers
export function periodRange(period: SummaryPeriod): { from: string; to: string } {
  if (period.kind === 'month') return { from: period.month, to: period.month };
  return { from: `${period.year}-01`, to: `${period.year}-12` };
}

export function periodLabel(period: SummaryPeriod): string {
  if (period.kind === 'year') return String(period.year);
  const [year, m] = period.month.split('-').map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });
}

export function monthName(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString('de-CH', { month: 'long' });
}

// Positions are matched by name (and kind for priorities), so renaming one starts a new line
const label = (name: string) => name.trim() || 'Ohne Namen';

export function summarize(period: SummaryPeriod, budgets: MonthBudget[]): Summary {
  const { from, to } = periodRange(period);
  const inPeriod = budgets.filter((b) => b.month >= from && b.month <= to).sort((a, b) => a.month.localeCompare(b.month));

  const expenses = new Map<string, SummaryExpense>();
  const priorities = new Map<string, SummaryPriority>();

  const months = inPeriod.map((budget) => {
    const result = allocate(budget);
    for (const expense of budget.expenses) {
      const name = label(expense.name);
      const entry = expenses.get(name) ?? { name, total: 0, months: 0 };
      entry.total += expenseTotal(expense);
      entry.months += 1;
      expenses.set(name, entry);
    }
    for (const payment of result.priorities) {
      const name = label(payment.name);
      const key = `${payment.kind}/${name}`;
      const entry = priorities.get(key) ?? { kind: payment.kind, name, startAmount: payment.amount, paid: 0, remaining: 0 };
      entry.paid += payment.payment;
      entry.remaining = payment.remaining;
      priorities.set(key, entry);
    }
    return {
      month: budget.month,
      startBalance: budget.startBalance,
      income: budget.income,
      plannedTotal: result.plannedTotal,
      debtTotal: result.debtTotal,
      savingsTotal: result.savingsTotal,
      endBalance: result.endBalance,
      plannedCovered: result.plannedCovered,
    };
  });

  const summaryPriorities = [...priorities.values()];
  return {
    period,
    months,
    startBalance: months[0]?.startBalance ?? 0,
    income: sum(months.map((m) => m.income)),
    plannedTotal: sum(months.map((m) => m.plannedTotal)),
    debtTotal: sum(months.map((m) => m.debtTotal)),
    savingsTotal: sum(months.map((m) => m.savingsTotal)),
    endBalance: months.at(-1)?.endBalance ?? 0,
    remainingDebt: sum(summaryPriorities.filter((p) => p.kind === 'debt').map((p) => p.remaining)),
    uncoveredMonths: months.filter((m) => !m.plannedCovered).map((m) => m.month),
    expenses: [...expenses.values()].sort((a, b) => b.total - a.total),
    priorities: summaryPriorities,
  };
}
