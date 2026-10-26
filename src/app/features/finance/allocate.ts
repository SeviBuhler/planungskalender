// Monthly budget allocation:
// 1. planned expenses must be covered, 2. debts are paid in order, 3. savings get what is left.

export interface PlannedExpense {
  name: string;
  amountPerUnit: number;
  quantity: number;
  note?: string;
}

export interface Debt {
  name: string;
  open: number;
  note?: string;
}

export interface SavingsGoal {
  name: string;
  target: number;
  desiredRate: number;
}

export interface MonthBudget {
  month: string; // YYYY-MM
  startBalance: number;
  income: number;
  expenses: PlannedExpense[];
  debts: Debt[]; // in order of priority
  savings: SavingsGoal[]; // in order of priority
}

export interface DebtPayment {
  name: string;
  open: number;
  payment: number;
  remaining: number;
}

export interface SavingsPayment {
  name: string;
  target: number;
  rate: number;
  remaining: number;
}

export interface Allocation {
  totalAvailable: number;
  plannedTotal: number;
  availableForDebtsAndSavings: number;
  debts: DebtPayment[];
  debtTotal: number;
  savings: SavingsPayment[];
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

export function allocate(budget: MonthBudget): Allocation {
  const totalAvailable = budget.startBalance + budget.income;
  const plannedTotal = sum(budget.expenses.map(expenseTotal));
  const availableForDebtsAndSavings = totalAvailable - plannedTotal;

  let left = Math.max(0, availableForDebtsAndSavings);

  const debts = budget.debts.map((debt) => {
    const payment = Math.min(debt.open, left);
    left -= payment;
    return { name: debt.name, open: debt.open, payment, remaining: debt.open - payment };
  });

  const savings = budget.savings.map((goal) => {
    const rate = Math.min(goal.desiredRate, goal.target, left);
    left -= rate;
    return { name: goal.name, target: goal.target, rate, remaining: goal.target - rate };
  });

  const debtTotal = sum(debts.map((d) => d.payment));
  const savingsTotal = sum(savings.map((s) => s.rate));
  const totalSpent = plannedTotal + debtTotal + savingsTotal;

  return {
    totalAvailable,
    plannedTotal,
    availableForDebtsAndSavings,
    debts,
    debtTotal,
    savings,
    savingsTotal,
    totalSpent,
    endBalance: totalAvailable - totalSpent,
    plannedCovered: totalAvailable >= plannedTotal,
    remainingDebt: sum(debts.map((d) => d.remaining)),
  };
}

export function nextMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(year, m, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Starts the following month from this one: end balance becomes the start balance,
// paid-off debts and reached savings goals drop out, income has to be entered again.
export function carryOver(budget: MonthBudget): MonthBudget {
  const result = allocate(budget);
  return {
    month: nextMonth(budget.month),
    startBalance: result.endBalance,
    income: 0,
    expenses: budget.expenses.map((e) => ({ ...e })),
    debts: budget.debts
      .map((d, i) => ({ ...d, open: result.debts[i].remaining }))
      .filter((d) => d.open > 0),
    savings: budget.savings
      .map((s, i) => ({ ...s, target: result.savings[i].remaining }))
      .filter((s) => s.target > 0),
  };
}
