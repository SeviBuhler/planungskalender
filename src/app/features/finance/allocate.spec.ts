import { MonthBudget, PriorityItem, allocate, budgetFor, carryOver, computedCarry, nextMonth, normalizeBudget, resolveCarry } from './allocate';

const debt = (name: string, amount: number, desiredRate: number | null = null): PriorityItem => ({ kind: 'debt', name, amount, desiredRate });
const saving = (name: string, amount: number, desiredRate: number | null): PriorityItem => ({ kind: 'saving', name, amount, desiredRate });

const BUDGET: MonthBudget = {
  month: '2026-11',
  startBalance: 200,
  carryOverride: null,
  incomes: [{ name: 'Lohn', amount: 3000 }],
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

    expect(result.incomeTotal).toBe(3000);
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
    const result = allocate({ ...BUDGET, incomes: [{ name: 'Lohn', amount: 1000 }] });

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
      month: '2026-10', startBalance: 0, incomes: [{ name: 'Einnahme', amount: 1000 }], expenses: [],
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
    expect(next.carryOverride).toBeNull();
    expect(next.incomes).toEqual(BUDGET.incomes);
    expect(next.incomes).not.toBe(BUDGET.incomes);
    expect(next.priorities).toEqual([debt('Kreditkarte', 200), debt('Privat', 300), saving('Handy', 600, 100), saving('Computer', 2000, 200)]);
    expect(next.expenses).not.toBe(BUDGET.expenses);
  });

  it('drops one-time expenses and keeps the recurring ones', () => {
    const next = carryOver({ ...BUDGET, expenses: [...BUDGET.expenses, { name: 'Zahnarzt', amountPerUnit: 300, quantity: 1, oneTime: true }] });

    expect(next.expenses.map((e) => e.name)).toEqual(['Miete', 'Einkauf']);
  });

  it('rolls over the year', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
  });
});

describe('carry-over chain', () => {
  const month = (m: string, income: number, carryOverride: number | null = null): MonthBudget => ({
    month: m, startBalance: 0, carryOverride, incomes: [{ name: 'Lohn', amount: income }],
    expenses: [{ name: 'Miete', amountPerUnit: 1000, quantity: 1 }], priorities: [],
  });

  it('carries the balance into the next month and across the turn of the year', () => {
    const resolved = resolveCarry([month('2027-01', 1500), month('2026-11', 1200), month('2026-12', 1300)]);
    expect(resolved.map((b) => [b.month, b.startBalance])).toEqual([['2026-11', 0], ['2026-12', 200], ['2027-01', 500]]);
    expect(computedCarry('2027-02', resolved)).toBe(1000);
  });

  it('lets an override reach all following months and resets to the computed value', () => {
    const resolved = resolveCarry([month('2026-11', 1200), month('2026-12', 1300, 5000), month('2027-01', 1500)]);
    expect(resolved.map((b) => b.startBalance)).toEqual([0, 5000, 5300]);
    expect(computedCarry('2026-12', resolved)).toBe(200);
  });

  it('carries over through months that were never saved', () => {
    const resolved = resolveCarry([month('2026-10', 1500)]);
    // November is carried over (income stays): 500 + 1500 - 1000 = 1000 into December
    expect(computedCarry('2026-12', resolved)).toBe(1000);
    const december = budgetFor('2026-12', resolved)!;
    expect(december.startBalance).toBe(1000);
    expect(december.carryOverride).toBeNull();
    expect(budgetFor('2026-09', resolved)).toBeNull();
  });

  it('keeps the start balance of the first month saved before the override existed', () => {
    const { carryOverride, ...legacy } = month('2026-10', 1500);
    const later = { ...month('2026-11', 1000), startBalance: 123 };
    delete (later as Partial<MonthBudget>).carryOverride;
    const resolved = resolveCarry([{ ...legacy, startBalance: 800 }, later]);
    expect(resolved.map((b) => [b.carryOverride, b.startBalance])).toEqual([[800, 800], [null, 1300]]);
    expect(carryOverride).toBeNull();
  });
});
