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

export interface IncomeItem {
  name: string;
  amount: number;
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
  startBalance: number; // "Übertrag Vormonat": the override if set, otherwise the previous month's balance
  carryOverride?: number | null; // null: computed; missing only in months saved before the override existed
  incomes: IncomeItem[];
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
  incomeTotal: number;
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

export function incomeTotal(budget: MonthBudget): number {
  return sum(budget.incomes.map((i) => i.amount));
}

interface LegacyBudget {
  income?: number;
  debts?: { name: string; open: number; note?: string }[];
  savings?: { name: string; target: number; desiredRate: number }[];
}

// Months saved before the shared priority list had separate debts (paid in full, first)
// and savings lists; they keep their result: debts first, then savings.
// A single income from before the income list becomes the position "Einnahme".
export function normalizeBudget(raw: MonthBudget & LegacyBudget): MonthBudget {
  const { debts, savings, income, ...base } = raw;
  const rest = { ...base, incomes: raw.incomes ?? (income ? [{ name: 'Einnahme', amount: income }] : []) };
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
  const incomes = incomeTotal(budget);
  const totalAvailable = budget.startBalance + incomes;
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
    incomeTotal: incomes,
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

// Starts the following month from this one: the end balance is carried over, incomes and monthly
// expenses stay, one-time expenses, paid-off debts and reached savings goals drop out.
export function carryOver(budget: MonthBudget): MonthBudget {
  const result = allocate(budget);
  return {
    month: nextMonth(budget.month),
    startBalance: result.endBalance,
    carryOverride: null,
    incomes: budget.incomes.map((i) => ({ ...i })),
    expenses: budget.expenses.filter((e) => !e.oneTime).map((e) => ({ ...e })),
    priorities: budget.priorities
      .map((item, i) => ({ ...item, amount: result.priorities[i].remaining }))
      .filter((item) => item.amount > 0),
  };
}

// What is carried into `month` without an override: the balance at the end of the month before,
// across the turn of the year. Months in between that were never saved count as carried over.
// `resolved` are saved months, oldest first, with their own carry-over already resolved.
export function computedCarry(month: string, resolved: MonthBudget[]): number {
  let before = resolved.filter((b) => b.month < month).at(-1);
  if (!before) return 0;
  while (nextMonth(before.month) < month) before = carryOver(before);
  return allocate(before).endBalance;
}

// Fills in the carry-over of every saved month from the months before it, oldest first, so an
// override or a change in one month reaches all following months
export function resolveCarry(saved: MonthBudget[]): MonthBudget[] {
  const resolved: MonthBudget[] = [];
  for (const budget of [...saved].sort((a, b) => a.month.localeCompare(b.month))) {
    // Not yet migrated: the first month keeps its start balance, it has no month before it
    const override = budget.carryOverride !== undefined ? budget.carryOverride : resolved.length ? null : budget.startBalance || null;
    resolved.push({ ...budget, carryOverride: override, startBalance: override ?? computedCarry(budget.month, resolved) });
  }
  return resolved;
}

// The month as it is saved, or carried over from the last saved month before it
export function budgetFor(month: string, resolved: MonthBudget[]): MonthBudget | null {
  const saved = resolved.find((b) => b.month === month);
  if (saved) return saved;
  let before = resolved.filter((b) => b.month < month).at(-1);
  if (!before) return null;
  while (before.month < month) before = carryOver(before);
  return before;
}
