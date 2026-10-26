import { MonthBudget, PriorityItem, allocate, carryOver, nextMonth, normalizeBudget } from './allocate';

const debt = (name: string, amount: number, desiredRate: number | null = null): PriorityItem => ({ kind: 'debt', name, amount, desiredRate });
const saving = (name: string, amount: number, desiredRate: number | null): PriorityItem => ({ kind: 'saving', name, amount, desiredRate });

const BUDGET: MonthBudget = {
  month: '2026-11',
  startBalance: 200,
  income: 3000,
  expenses: [
    { name: 'Miete', amountPerUnit: 1000, quantity: 1 },
    { name: 'Einkauf', amountPerUnit: 100, quantity: 4 },
  ],
  priorities: [
    debt('Rechnung', 500),
    debt('Kreditkarte', 1500),
    debt('Privat', 300),
    saving('Handy', 600, 100),
    saving('Computer', 2000, 200),
  ],
};

describe('allocate', () => {
  it('covers planned expenses first, then pays the priority list from the top', () => {
    const result = allocate(BUDGET);

    expect(result.totalAvailable).toBe(3200);
    expect(result.plannedTotal).toBe(1400);
    expect(result.availableForPriorities).toBe(1800);
    expect(result.priorities.map((p) => p.payment)).toEqual([500, 1300, 0, 0, 0]);
    expect(result.endBalance).toBe(0);
    expect(result.remainingDebt).toBe(500);
    expect(result.plannedCovered).toBe(true);
  });

  it('pays each position at most its desired payment', () => {
    const result = allocate({ ...BUDGET, priorities: [debt('Kreditkarte', 1500, 400), saving('Handy', 600, 100), debt('Privat', 300)] });

    expect(result.priorities.map((p) => p.payment)).toEqual([400, 100, 300]);
    expect(result.debtTotal).toBe(700);
    expect(result.savingsTotal).toBe(100);
    expect(result.endBalance).toBe(1800 - 800);
  });

  it('lets savings come before debts', () => {
    const result = allocate({ ...BUDGET, priorities: [saving('Notgroschen', 5000, null), debt('Rechnung', 500)] });

    expect(result.priorities.map((p) => p.payment)).toEqual([1800, 0]);
    expect(result.remainingDebt).toBe(500);
  });

  it('pays nothing extra when planned expenses are not covered', () => {
    const result = allocate({ ...BUDGET, income: 1000 });

    expect(result.plannedCovered).toBe(false);
    expect(result.debtTotal).toBe(0);
    expect(result.savingsTotal).toBe(0);
    expect(result.endBalance).toBe(1200 - 1400);
  });

  it('never pays more than the open amount', () => {
    const result = allocate({ ...BUDGET, priorities: [saving('Handy', 50, 100)] });

    expect(result.priorities[0]).toEqual({ kind: 'saving', name: 'Handy', amount: 50, payment: 50, remaining: 0 });
  });
});

describe('normalizeBudget', () => {
  it('turns months saved with separate debts and savings into one list with the same result', () => {
    const legacy = {
      month: '2026-10', startBalance: 0, income: 1000, expenses: [],
      debts: [{ name: 'Skema', open: 300, note: 'x' }],
      savings: [{ name: 'Handy', target: 600, desiredRate: 100 }],
    } as unknown as MonthBudget;

    const budget = normalizeBudget(legacy);
    expect(budget).toEqual({
      month: '2026-10', startBalance: 0, income: 1000, expenses: [],
      priorities: [
        { kind: 'debt', name: 'Skema', amount: 300, desiredRate: null, note: 'x' },
        { kind: 'saving', name: 'Handy', amount: 600, desiredRate: 100 },
      ],
    });
    expect(allocate(budget).priorities.map((p) => p.payment)).toEqual([300, 100]);
  });

  it('keeps budgets that already use the priority list', () => {
    expect(normalizeBudget(BUDGET)).toEqual(BUDGET);
  });
});

describe('carryOver', () => {
  it('starts the next month from the remaining balance and open amounts', () => {
    const next = carryOver(BUDGET);

    expect(next.month).toBe('2026-12');
    expect(next.startBalance).toBe(0);
    expect(next.income).toBe(0);
    expect(next.priorities).toEqual([debt('Kreditkarte', 200), debt('Privat', 300), saving('Handy', 600, 100), saving('Computer', 2000, 200)]);
    expect(next.expenses).not.toBe(BUDGET.expenses);
  });

  it('rolls over the year', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
  });
});
