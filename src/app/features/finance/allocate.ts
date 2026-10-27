// Monthly budget allocation:
// 1. planned expenses must be covered, 2. debts and savings goals share one priority list
// and are paid top to bottom, each up to its desired payment.

export interface PlannedExpense {
  name: string;
  amountPerUnit: number;
  quantity: number;
  note?: string;
  oneTime?: boolean; // true: only in the month it was created in; otherwise it carries over
}

export type PriorityKind = 'debt' | 'saving';

export interface PriorityItem {
  kind: PriorityKind;
  name: string;
  amount: number; // open debt or remaining savings target
  desiredRate: number | null; // null: as much as possible
  note?: string;
}

export interface MonthBudget {
  month: string; // YYYY-MM
  startBalance: number;
  income: number;
  expenses: PlannedExpense[];
  priorities: PriorityItem[]; // debts and savings, highest priority first
}

export interface PriorityPayment {
  kind: PriorityKind;
  name: string;
  amount: number;
  payment: number;
  remaining: number;
}

export interface Allocation {
  totalAvailable: number;
  plannedTotal: number;
  availableForPriorities: number;
  priorities: PriorityPayment[];
  debtTotal: number;
  savingsTotal: number;
  totalSpent: number;
  endBalance: number;
  plannedCovered: boolean;
  remainingDebt: number;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export function expenseTotal(expense: PlannedExpense): number {
  return expense.amountPerUnit * expense.quantity;
}

interface LegacyBudget {
  debts?: { name: string; open: number; note?: string }[];
  savings?: { name: string; target: number; desiredRate: number }[];
}

// Months saved before the shared priority list had separate debts (paid in full, first)
// and savings lists; they keep their result: debts first, then savings
export function normalizeBudget(raw: MonthBudget & LegacyBudget): MonthBudget {
  const { debts, savings, ...rest } = raw;
  if (raw.priorities) return { ...rest, priorities: raw.priorities };
  return {
    ...rest,
    priorities: [
      ...(debts ?? []).map((d) => ({ kind: 'debt' as const, name: d.name, amount: d.open, desiredRate: null, ...(d.note ? { note: d.note } : {}) })),
      ...(savings ?? []).map((g) => ({ kind: 'saving' as const, name: g.name, amount: g.target, desiredRate: g.desiredRate })),
    ],
  };
}

export function allocate(budget: MonthBudget): Allocation {
  const totalAvailable = budget.startBalance + budget.income;
  const plannedTotal = sum(budget.expenses.map(expenseTotal));
  const availableForPriorities = totalAvailable - plannedTotal;

  let left = Math.max(0, availableForPriorities);

  const priorities = budget.priorities.map((item) => {
    const payment = Math.max(0, Math.min(item.amount, item.desiredRate ?? item.amount, left));
    left -= payment;
    return { kind: item.kind, name: item.name, amount: item.amount, payment, remaining: item.amount - payment };
  });

  const total = (kind: PriorityKind) => sum(priorities.filter((p) => p.kind === kind).map((p) => p.payment));
  const debtTotal = total('debt');
  const savingsTotal = total('saving');
  const totalSpent = plannedTotal + debtTotal + savingsTotal;

  return {
    totalAvailable,
    plannedTotal,
    availableForPriorities,
    priorities,
    debtTotal,
    savingsTotal,
    totalSpent,
    endBalance: totalAvailable - totalSpent,
    plannedCovered: totalAvailable >= plannedTotal,
    remainingDebt: sum(priorities.filter((p) => p.kind === 'debt').map((p) => p.remaining)),
  };
}

export function nextMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(year, m, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Starts the following month from this one: end balance becomes the start balance,
// one-time expenses, paid-off debts and reached savings goals drop out, income has to be entered again.
export function carryOver(budget: MonthBudget): MonthBudget {
  const result = allocate(budget);
  return {
    month: nextMonth(budget.month),
    startBalance: result.endBalance,
    income: 0,
    expenses: budget.expenses.filter((e) => !e.oneTime).map((e) => ({ ...e })),
    priorities: budget.priorities
      .map((item, i) => ({ ...item, amount: result.priorities[i].remaining }))
      .filter((item) => item.amount > 0),
  };
}
